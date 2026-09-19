#!/usr/bin/env bun
// @bun

// src/scripts/plan_checks.ts
import { appendFileSync } from "fs";
import { parseArgs } from "util";

// src/lib/config.ts
import { readFileSync } from "fs";

// src/domain/merge-readiness.ts
var CI_WOULD_BE_WASTED = new Set([
  "not-open",
  "draft",
  "conflicting",
  "behind",
  "mergeability-unknown",
  "checks-pending",
  "checks-failing"
]);
var PASSING = new Set(["success", "neutral", "skipped"]);

// src/domain/runner-label.ts
var DEFAULT_RUNNER = "ubuntu-latest";
function resolveRunsOn(configured) {
  if (configured === undefined || configured === null)
    return { labels: [DEFAULT_RUNNER], problems: [] };
  if (typeof configured === "string") {
    const label = configured.trim();
    if (!label)
      return { labels: [DEFAULT_RUNNER], problems: ["runs_on is empty; using " + DEFAULT_RUNNER] };
    return { labels: [label], problems: [] };
  }
  if (Array.isArray(configured)) {
    const labels = configured.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
    const problems = [];
    if (labels.length !== configured.length) {
      problems.push("runs_on has entries that are not non-empty strings; those are ignored");
    }
    if (labels.length === 0) {
      return { labels: [DEFAULT_RUNNER], problems: [...problems, `runs_on names no usable label; using ${DEFAULT_RUNNER}`] };
    }
    return { labels, problems };
  }
  return { labels: [DEFAULT_RUNNER], problems: [`runs_on must be a string or a list of strings; using ${DEFAULT_RUNNER}`] };
}
function runsOnOutput(labels) {
  return JSON.stringify(labels);
}

// src/domain/declared-jobs.ts
var NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var SHARED_KEYS = ["name", "runs_on", "commands", "secrets"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveDeclaredJobs(raw, rules) {
  if (raw === undefined || raw === null)
    return { jobs: [], problems: [] };
  if (!Array.isArray(raw))
    return { jobs: [], problems: [`\`${rules.where}\` must be an array.`] };
  const problems = [];
  const jobs = [];
  const seen = new Set;
  const allowed = new Set([...SHARED_KEYS, ...rules.extraKeys ?? []]);
  raw.forEach((entry, index) => {
    const where = `\`${rules.where}[${index}]\``;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      return;
    }
    const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      problems.push(`${where}: unknown key(s) ${unknown.map((k) => `\`${k}\``).join(", ")}.`);
      return;
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!NAME_PATTERN.test(name)) {
      problems.push(`${where}: \`name\` must be lowercase letters, digits and hyphens \u2014 e.g. 'cloud-names'.`);
      return;
    }
    if (seen.has(name)) {
      problems.push(`${where}: '${name}' is declared more than once.`);
      return;
    }
    const commandsRaw = entry.commands ?? [];
    if (!Array.isArray(commandsRaw) || commandsRaw.some((c) => typeof c !== "string" || c.trim() === "")) {
      problems.push(`${where}: \`commands\` must be an array of non-empty shell commands.`);
      return;
    }
    const commands = commandsRaw.map((c) => c.trim());
    if (commands.length === 0) {
      problems.push(`${where}: \`commands\` is empty, so this job would do nothing and report success.`);
      return;
    }
    const secretsRaw = entry.secrets ?? [];
    if (!Array.isArray(secretsRaw) || secretsRaw.some((s) => typeof s !== "string" || s.trim() === "")) {
      problems.push(`${where}: \`secrets\` must be an array of repository secret names.`);
      return;
    }
    const secrets = secretsRaw.map((s) => s.trim());
    if (!rules.secretsAllowed && secrets.length > 0) {
      problems.push(`${where}: \`secrets\` cannot be named here. These commands come from the pull request, ` + `which may rewrite them, so a credential named beside them is one the change being judged can read.`);
      return;
    }
    const runner = resolveRunsOn(entry.runs_on);
    for (const problem of runner.problems)
      problems.push(`${where}: ${problem}`);
    seen.add(name);
    jobs.push({ name, runsOn: runner.labels, commands, secrets });
  });
  return { jobs, problems };
}

// src/domain/machinery-layout.ts
var USER_ROOT = ".github/atomaton";
var RUNTIME_ROOT = ".github/atomaton-runtime";
var CONFIG_FILE = `${USER_ROOT}/config.yaml`;
var AGENT_DEFINITIONS_DIR = `${USER_ROOT}/agent-definitions`;
var PROMPT_TEMPLATE = `${USER_ROOT}/prompt-template.md`;
var SKILLS_DIR = `${USER_ROOT}/skills`;
var TOOLS_DIR = `${RUNTIME_ROOT}/tools`;
var TOOL_DEFAULTS_FILE = `${TOOLS_DIR}/defaults.yaml`;
var TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;
var TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;
var RULESETS_DIR = `${USER_ROOT}/rulesets`;
var SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;

// src/lib/config.ts
function configPath() {
  const root = process.env.ATOMATON_MACHINERY_ROOT?.trim();
  return root ? `${root}/${CONFIG_FILE}` : CONFIG_FILE;
}
var cached;
function loadConfig() {
  if (!cached) {
    cached = Bun.YAML.parse(readFileSync(configPath(), "utf8"));
  }
  return cached;
}
function getPullRequestChecks() {
  return resolveDeclaredJobs(loadConfig().checks?.from_pull_request, {
    where: "checks.from_pull_request",
    secretsAllowed: false
  });
}
function getDefaultBranchChecks() {
  return resolveDeclaredJobs(loadConfig().checks?.from_default_branch, {
    where: "checks.from_default_branch",
    secretsAllowed: true
  });
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/plan_checks.ts
var ref = defineScript(import.meta.url);
var ARMS = {
  "pull-request": {
    read: getPullRequestChecks,
    key: "checks.from_pull_request",
    warnWhenEmpty: "This check verified nothing: `checks.from_pull_request` in .github/atomaton/config.yaml is empty, " + "so a pull request satisfying it has not been tested. Add the commands that check this project, " + "or point `checks.your_workflow` at a workflow of your own."
  },
  "default-branch": {
    read: getDefaultBranchChecks,
    key: "checks.from_default_branch",
    warnWhenEmpty: ""
  }
};
function main() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { arm: { type: "string" } } });
  const arm = ARMS[values.arm ?? ""];
  if (!arm) {
    console.error(`usage: plan_checks.ts --arm ${Object.keys(ARMS).join("|")}`);
    process.exit(2);
  }
  const { jobs, problems } = arm.read();
  if (problems.length > 0) {
    for (const problem of problems)
      console.error(`::error::${problem}`);
    console.error(`::error::\`${arm.key}\` could not be read, so none of its checks ran.`);
    process.exit(1);
  }
  const include = jobs.map((job) => ({
    name: job.name,
    runs_on: runsOnOutput(job.runsOn),
    commands: job.commands,
    secrets: job.secrets
  }));
  const output = process.env.GITHUB_OUTPUT;
  const line = `jobs=${JSON.stringify(include)}
`;
  if (output)
    appendFileSync(output, line);
  else
    process.stdout.write(line);
  if (include.length === 0) {
    console.error(arm.warnWhenEmpty ? `::warning::${arm.warnWhenEmpty}` : `No \`${arm.key}\` checks are declared.`);
    return;
  }
  console.error(`${include.length} \`${arm.key}\` job(s): ${include.map((job) => job.name).join(", ")}`);
}
if (import.meta.main)
  main();
export {
  main,
  ref
};

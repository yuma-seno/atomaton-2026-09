#!/usr/bin/env bun
// @bun

// src/scripts/plan_deploy.ts
import { parseArgs } from "util";

// src/domain/declared-secrets.ts
var SECRET_SLOTS = 10;
var SECRET_SLOT_PREFIX = "ATOMATON_SECRET_";
var NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
var RUN_CREDENTIALS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ORCAROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ATOMA_COPILOT_TOKEN",
  "GH_TOKEN"
];
var TOOL_SECRETS = {
  field: "tools.secrets",
  reserved: new Set([
    ...RUN_CREDENTIALS,
    "AGENT",
    "ATOMATON_OPS_LOG",
    "ATOMA_PROVIDER",
    "ATOMATON_RELOAD_COUNT",
    "ATOMATON_RUN_TYPE",
    "GITHUB_RUN_ID",
    "ISSUE_NOTIFY",
    "ISSUE_NUMBER",
    "OPENAI_BASE_URL",
    "OPENROUTER_BASE_URL",
    "ORCAROUTER_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "COPILOT_BASE_URL",
    "ATOMA_PROVIDER_IN",
    "OPENAI_BASE_URL_IN"
  ])
};
var JOB_ENV = ["ATOMATON_COMMANDS", "GH_TOKEN"];
var CHECK_JOB_RESERVED = new Set([...JOB_ENV, "ATOMATON_PR_TREE"]);
var DEPLOY_JOB_RESERVED = new Set([...JOB_ENV, "ATOMATON_DEPLOY_TARGET"]);
function resolveDeclaredSecrets(raw, destination) {
  const { field, reserved } = destination;
  if (raw === undefined || raw === null)
    return { names: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { names: [], problems: [`\`${field}\` must be an array of secret names.`] };
  }
  const problems = [];
  const names = [];
  const seen = new Set;
  for (const entry of raw) {
    if (typeof entry !== "string") {
      problems.push(`\`${field}\` entries must be strings; found ${JSON.stringify(entry)}.`);
      continue;
    }
    const name = entry.trim();
    if (!NAME_PATTERN.test(name)) {
      problems.push(`\`${field}\`: '${name}' is not a usable secret name. Expected uppercase letters, digits and underscores, starting with a letter \u2014 e.g. 'SLACK_TOKEN'.`);
      continue;
    }
    if (reserved.has(name)) {
      problems.push(`\`${field}\`: '${name}' is already part of the environment this workflow provides, so declaring it would replace that value rather than add a credential. Give the secret another name.`);
      continue;
    }
    if (name.startsWith(SECRET_SLOT_PREFIX)) {
      problems.push(`\`${field}\`: '${name}' collides with the slots this mechanism uses internally. Give the secret another name.`);
      continue;
    }
    if (seen.has(name)) {
      problems.push(`\`${field}\`: '${name}' is declared more than once.`);
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  if (names.length > SECRET_SLOTS) {
    problems.push(`\`${field}\` declares ${names.length} secrets but a run carries at most ${SECRET_SLOTS}. Raising the cap needs a new release, since each slot is a line of generated workflow YAML.`);
  }
  return problems.length > 0 ? { names: [], problems } : { names, problems };
}

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
var NAME_PATTERN2 = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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
  const allowed = new Set([...SHARED_KEYS, ...rules.extra?.keys ?? []]);
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
    if (!NAME_PATTERN2.test(name)) {
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
    const secrets = readSecrets(entry.secrets, rules.secrets, `${rules.where}[${index}]`, where, problems);
    if (secrets === null)
      return;
    const extra = rules.extra ? rules.extra.read(entry, where, problems) : {};
    if (extra === null)
      return;
    const runner = resolveRunsOn(entry.runs_on);
    for (const problem of runner.problems)
      problems.push(`${where}: ${problem}`);
    seen.add(name);
    jobs.push({ name, runsOn: runner.labels, commands, secrets, ...extra });
  });
  return { jobs, problems };
}
function readSecrets(raw, rule, path, where, problems) {
  if (raw === undefined || raw === null)
    return [];
  if ("refused" in rule) {
    if (Array.isArray(raw) && raw.length === 0)
      return [];
    problems.push(`${where}: \`secrets\` cannot be named here. ${rule.refused}`);
    return null;
  }
  const { names, problems: found } = resolveDeclaredSecrets(raw, {
    field: `${path}.secrets`,
    reserved: rule.reserved
  });
  problems.push(...found);
  return found.length > 0 ? null : names;
}

// src/domain/deploy-jobs.ts
function refMatches(pattern, ref) {
  return pattern.endsWith("*") ? ref.startsWith(pattern.slice(0, -1)) : ref === pattern;
}
function refPatternProblem(pattern) {
  const body = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
  if (body.includes("*")) {
    return `"${pattern}" uses a '*' somewhere other than the end, which this matcher cannot honour, ` + 'so it would match nothing. Write a literal ref, or a prefix followed by "*" \u2014 e.g. "v*".';
  }
  if (/[?[\]{}]/.test(body)) {
    return `"${pattern}" uses a glob character this matcher cannot honour, so it would match nothing. ` + 'Write a literal ref, or a prefix followed by "*".';
  }
  return "";
}
function readPatterns(raw, key, required, where, problems) {
  const list = raw ?? [];
  if (!Array.isArray(list) || list.some((p) => typeof p !== "string" || p.trim() === "")) {
    problems.push(`${where}: \`${key}\` must be an array of non-empty patterns.`);
    return null;
  }
  const patterns = list.map((p) => p.trim());
  const bad = patterns.map(refPatternProblem).find((problem) => problem !== "");
  if (bad) {
    problems.push(`${where}: ${bad}`);
    return null;
  }
  if (required && patterns.length === 0) {
    problems.push(`${where}: \`${key}\` needs at least one pattern \u2014 e.g. ["v*"].`);
    return null;
  }
  return patterns;
}
function refsFrom(key, required) {
  return {
    keys: [key],
    read: (entry, where, problems) => {
      const refs = readPatterns(entry[key], key, required, where, problems);
      return refs === null ? null : { refs };
    }
  };
}
var DEPLOY_ARMS = {
  merge: {
    key: "on_merge",
    rules: {
      where: "deploy.on_merge",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: refsFrom("branches", false)
    }
  },
  tag: {
    key: "on_tag",
    rules: {
      where: "deploy.on_tag",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: refsFrom("tags", true)
    }
  },
  demand: {
    key: "on_demand",
    rules: {
      where: "deploy.on_demand",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: { keys: [], read: () => ({ refs: [] }) }
    }
  }
};
var TRIGGERS = Object.keys(DEPLOY_ARMS);
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveDeployJobs(deploy) {
  const section = isRecord2(deploy) ? deploy : {};
  const problems = [];
  const jobs = [];
  const seen = new Set;
  for (const trigger of TRIGGERS) {
    const arm = DEPLOY_ARMS[trigger];
    const resolved = resolveDeclaredJobs(section[arm.key], arm.rules);
    problems.push(...resolved.problems);
    for (const job of resolved.jobs) {
      if (seen.has(job.name)) {
        problems.push(`\`${arm.key}\`: '${job.name}' is already declared in another \`deploy\` list.`);
        continue;
      }
      seen.add(job.name);
      jobs.push({ ...job, trigger });
    }
  }
  return problems.length > 0 ? { jobs: [], problems } : { jobs, problems };
}
function branchOf(ref) {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}
function tagOf(ref) {
  return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "";
}
function mergeJobsFor(jobs, branch, defaultBranch) {
  if (!branch)
    return [];
  return jobs.filter((job) => job.trigger === "merge" && (job.refs.length === 0 ? branch === defaultBranch : job.refs.some((pattern) => refMatches(pattern, branch))));
}
function selectDeployJobs(jobs, request) {
  if (request.target) {
    const named = jobs.find((job) => job.name === request.target);
    return named ? [named] : null;
  }
  if (request.event === "push") {
    const tag = tagOf(request.ref);
    if (tag)
      return jobs.filter((job) => job.trigger === "tag" && job.refs.some((p) => refMatches(p, tag)));
    return mergeJobsFor(jobs, branchOf(request.ref), request.defaultBranch);
  }
  if (request.trigger === "merge")
    return mergeJobsFor(jobs, branchOf(request.ref), request.defaultBranch);
  return jobs.filter((job) => job.trigger === "demand");
}

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

// src/domain/check-jobs.ts
var CHECKS_FROM_PULL_REQUEST = {
  where: "checks.from_pull_request",
  secrets: {
    refused: "These commands come from the pull request, which may rewrite them, so a credential " + "named beside them is one the change being judged can read. Move the check to " + "`checks.from_default_branch`, where the commands come from a branch a person approved."
  }
};
var NO_PULL_REQUEST_CHECKS = "This check verified nothing: `checks.from_pull_request` in .github/atomaton/config.yaml is empty, " + "so a pull request satisfying it has not been tested. Add the commands that check this project, " + "or point `checks.your_workflow` at a workflow of your own.";

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
function getDeploySection() {
  return loadConfig().deploy;
}

// src/scripts/lib/publish-matrix.ts
import { appendFileSync } from "fs";
function publishMatrix(jobs, options) {
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
    console.error(options.warnWhenEmpty ? `::warning::${options.warnWhenEmpty}` : `No ${options.what}s to run.`);
    return;
  }
  console.error(`${include.length} ${options.what}(s): ${include.map((job) => job.name).join(", ")}`);
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/plan_deploy.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      ref: { type: "string" },
      "default-branch": { type: "string" },
      event: { type: "string" },
      trigger: { type: "string" },
      target: { type: "string" }
    }
  });
  const request = {
    ref: values.ref ?? "",
    defaultBranch: (values["default-branch"] ?? "").trim(),
    event: (values.event ?? "").trim(),
    trigger: (values.trigger ?? "").trim(),
    target: (values.target ?? "").trim()
  };
  const { jobs, problems } = resolveDeployJobs(getDeploySection());
  if (problems.length > 0) {
    for (const problem of problems)
      console.error(`::error::.github/atomaton/config.yaml: ${problem}`);
    console.error("::error::`deploy` could not be read, so nothing was deployed.");
    process.exit(1);
  }
  const selected = selectDeployJobs(jobs, request);
  if (selected === null) {
    const known = jobs.map((job) => job.name).join(", ") || "none are configured";
    console.error(`::error::No deployment named '${request.target}'. Configured: ${known}.`);
    process.exit(1);
  }
  publishMatrix(selected, { what: "deployment" });
}
if (import.meta.main)
  main();
export {
  main,
  ref
};

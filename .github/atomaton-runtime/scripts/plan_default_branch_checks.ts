#!/usr/bin/env bun
// @bun

// src/scripts/plan_default_branch_checks.ts
import { appendFileSync } from "fs";

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

// src/domain/inspect-jobs.ts
var NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveInspectJobs(raw) {
  if (raw === undefined || raw === null)
    return { jobs: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { jobs: [], problems: ["`checks.default_branch_runs.jobs` must be an array."] };
  }
  const problems = [];
  const jobs = [];
  const seen = new Set;
  raw.forEach((entry, index) => {
    const where = `\`checks.default_branch_runs.jobs[${index}]\``;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
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
      problems.push(`${where}: \`commands\` is empty, so this job would pass without checking anything.`);
      return;
    }
    const secretsRaw = entry.secrets ?? [];
    if (!Array.isArray(secretsRaw) || secretsRaw.some((s) => typeof s !== "string" || s.trim() === "")) {
      problems.push(`${where}: \`secrets\` must be an array of repository secret names.`);
      return;
    }
    seen.add(name);
    jobs.push({ name, commands, secrets: secretsRaw.map((s) => s.trim()) });
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
function getInspectJobs() {
  return resolveInspectJobs(loadConfig().checks?.default_branch_runs?.jobs);
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/plan_default_branch_checks.ts
var ref = defineScript(import.meta.url);
function main() {
  const { jobs, problems } = getInspectJobs();
  if (problems.length > 0) {
    for (const problem of problems)
      console.error(`::error::${problem}`);
    console.error("::error::`checks.default_branch_runs.jobs` could not be read, so no credentialed check ran.");
    process.exit(1);
  }
  const include = jobs.map((job) => ({
    name: job.name,
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
  console.error(include.length === 0 ? "No credentialed checks are declared, so none will run." : `${include.length} credentialed check job(s): ${include.map((job) => job.name).join(", ")}`);
}
if (import.meta.main)
  main();
export {
  main,
  ref
};

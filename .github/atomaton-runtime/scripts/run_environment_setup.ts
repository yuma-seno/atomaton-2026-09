#!/usr/bin/env bun
// @bun

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

// src/domain/declared-secrets.ts
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

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/run_environment_setup.ts
var ref = defineScript(import.meta.url);
function main() {
  const commands = loadConfig().environment?.setup_commands ?? [];
  if (commands.length === 0) {
    console.log("No environment.setup_commands configured; skipping.");
    return;
  }
  for (const cmd of commands) {
    console.log(`Running environment setup command: ${cmd}`);
    const result = Bun.spawnSync({ cmd: ["bash", "-c", cmd], stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) {
      console.error(`environment setup command failed (exit ${result.exitCode}): ${cmd}`);
      process.exit(result.exitCode ?? 1);
    }
  }
}
if (import.meta.main)
  main();
export {
  ref
};

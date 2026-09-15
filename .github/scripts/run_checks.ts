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

// src/domain/machinery-layout.ts
var MACHINERY_ROOT = ".github/atoma";
var CONFIG_FILE = `${MACHINERY_ROOT}/config.yaml`;
var AGENT_DEFINITIONS_DIR = `${MACHINERY_ROOT}/agent-definitions`;
var PROMPT_TEMPLATE = `${MACHINERY_ROOT}/prompt-template.md`;
var SKILLS_DIR = `${MACHINERY_ROOT}/skills`;
var TOOLS_FILE = `${MACHINERY_ROOT}/tools/tools.yaml`;
var TOOL_HOOKS_DIR = `${MACHINERY_ROOT}/tools/scripts/hooks`;
var MCP_PACKAGES_FILE = `${MACHINERY_ROOT}/mcp-packages.json`;
var RULESETS_DIR = `${MACHINERY_ROOT}/rulesets`;

// src/lib/config.ts
function configPath() {
  const root = process.env.ATOMA_MACHINERY_ROOT?.trim();
  return root ? `${root}/${CONFIG_FILE}` : CONFIG_FILE;
}
var cached;
function loadConfig() {
  if (!cached) {
    cached = Bun.YAML.parse(readFileSync(configPath(), "utf8"));
  }
  return cached;
}
function getCheckCommands() {
  return loadConfig().checks?.atoma_runs?.commands?.filter((command) => command.trim() !== "") ?? [];
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
var SCRIPTS_RUNTIME_ROOT = ".github/scripts";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_RUNTIME_ROOT}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/run_checks.ts
var ref = defineScript(import.meta.url);
function main() {
  const commands = getCheckCommands();
  if (commands.length === 0) {
    console.log("::warning::This check verified nothing: `checks.atoma_runs.commands` in .github/atoma/config.yaml is empty, so a pull request satisfying it has not been tested. Add the commands that check this project, or point `checks.your_workflow` at a workflow of your own.");
    return;
  }
  console.log(`Running ${commands.length} check command(s).`);
  for (const command of commands) {
    console.log(`::group::${command}`);
    const result = Bun.spawnSync({ cmd: ["bash", "-c", command], stdout: "inherit", stderr: "inherit" });
    console.log("::endgroup::");
    if (result.exitCode !== 0) {
      console.error(`::error::Check failed (exit ${result.exitCode}): ${command}`);
      process.exit(result.exitCode ?? 1);
    }
  }
  console.log("All checks passed.");
}
if (import.meta.main)
  main();
export {
  ref
};

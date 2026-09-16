#!/usr/bin/env bun
// @bun

// src/scripts/manage_in_progress_label.ts
import { parseArgs } from "util";

// src/lib/gh.ts
function run(cmd) {
  const proc = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout ? proc.stdout.toString("utf8").trim() : "",
    stderr: proc.stderr ? proc.stderr.toString("utf8").trim() : ""
  };
}
function gh(...args) {
  return run(["gh", ...args]);
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

// src/domain/machinery-layout.ts
var USER_ROOT = ".github/atoma";
var RUNTIME_ROOT = ".github/atoma-runtime";
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
var DEFAULT_LABELS = {
  sub_issue: "atoma/sub-issue",
  launched: "atoma/launched",
  in_progress: "atoma/in-progress"
};
function getLabel(key) {
  return loadConfig().chain?.labels?.[key] ?? DEFAULT_LABELS[key];
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/manage_in_progress_label.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      action: { type: "string" },
      number: { type: "string" }
    }
  });
  if (values.action !== "add" && values.action !== "remove") {
    console.error("usage: manage_in_progress_label.ts --action add|remove --number N");
    process.exit(2);
  }
  if (!values.number) {
    console.error("usage: manage_in_progress_label.ts --action add|remove --number N");
    process.exit(2);
  }
  const label = getLabel("in_progress");
  if (values.action === "add") {
    gh("label", "create", label, "--force", "-c", "0366d6", "-d", "Issue is being worked on by an Atoma agent");
    const { code } = gh("issue", "edit", values.number, "--add-label", label);
    if (code !== 0)
      console.error(`Warning: failed to add '${label}' label to #${values.number}`);
  } else {
    const { code } = gh("issue", "edit", values.number, "--remove-label", label);
    if (code !== 0)
      console.error(`Warning: failed to remove '${label}' label from #${values.number}`);
  }
}
if (import.meta.main)
  main();
export {
  ref
};

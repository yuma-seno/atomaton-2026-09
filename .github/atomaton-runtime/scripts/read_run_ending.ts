#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/read_run_ending.ts
import { appendFileSync, existsSync, readFileSync } from "fs";
import { parseArgs } from "util";

// src/entrypoints/machinery/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";

// src/domain/machinery/machinery-layout.ts
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

// src/entrypoints/machinery/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/read_run_ending.ts
var ref = defineScript(import.meta.url);
var SOFT_STOP = "2";
function endingFromSession(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const runs = parsed.atoma_runs;
  if (!Array.isArray(runs) || runs.length === 0)
    return;
  const last = runs[runs.length - 1];
  return typeof last?.ended_because === "string" && last.ended_because !== "" ? last.ended_because : undefined;
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { session: { type: "string" }, "exit-code": { type: "string" }, "stop-file": { type: "string" } }
  });
  const exitCode = values["exit-code"] ?? "";
  const sessionPath = values.session ?? "";
  const recorded = existsSync(sessionPath) ? endingFromSession(readFileSync(sessionPath, "utf8")) : undefined;
  let ending;
  if (recorded !== undefined) {
    ending = recorded;
  } else if (exitCode === SOFT_STOP) {
    const stopFile = values["stop-file"] ?? "";
    ending = stopFile !== "" && existsSync(stopFile) ? "stopped" : "runtime";
    console.error(`read_run_ending: no record in the session; guessing "${ending}" from the stop file`);
  } else {
    ending = exitCode === "0" ? "completed" : "failed";
    console.error(`read_run_ending: no record in the session; taking "${ending}" from exit ${exitCode || "(none)"}`);
  }
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput)
    appendFileSync(githubOutput, `ended_because=${ending}
`);
  console.error(`read_run_ending: ended_because=${ending}`);
}
if (import.meta.main)
  main();
export {
  endingFromSession,
  ref
};

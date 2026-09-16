#!/usr/bin/env bun
// @bun

// src/scripts/decide_guard_release.ts
import { appendFileSync } from "fs";
import { parseArgs } from "util";

// src/domain/serialization-guard.ts
function shouldReleaseGuard(signals) {
  if (!signals.succeeded)
    return true;
  if (signals.limitReached)
    return true;
  if (signals.stopRequested)
    return true;
  if (signals.loopLimitReached)
    return true;
  return !signals.chainContinues && signals.directive === "";
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";

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

// src/scripts/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/decide_guard_release.ts
var ref = defineScript(import.meta.url);
function isTrue(v) {
  return v === "true";
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      outcome: { type: "string" },
      "limit-reached": { type: "string" },
      "stop-requested": { type: "string" },
      "loop-limit-reached": { type: "string" },
      "chain-continues": { type: "string" },
      directive: { type: "string" }
    }
  });
  if (!values.outcome) {
    console.error("decide_guard_release: --outcome missing/empty -- treating as non-success (releases the guard)");
  }
  const release = shouldReleaseGuard({
    succeeded: values.outcome === "success",
    limitReached: isTrue(values["limit-reached"]),
    stopRequested: isTrue(values["stop-requested"]),
    loopLimitReached: isTrue(values["loop-limit-reached"]),
    chainContinues: isTrue(values["chain-continues"]),
    directive: values.directive ?? ""
  });
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `should_release=${release}
`);
  }
  console.error(`decide_guard_release: outcome=${values.outcome ?? "(missing)"} -> should_release=${release}`);
}
if (import.meta.main)
  main();
export {
  ref
};

#!/usr/bin/env bun
// @bun

// src/scripts/check_live_tools.ts
import { existsSync, readdirSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
var MACHINERY_ROOT_VAR = "ATOMATON_MACHINERY_ROOT";

// src/lib/machinery.ts
function machineryRoot() {
  return process.env[MACHINERY_ROOT_VAR]?.trim() || undefined;
}
function machineryPath(relative) {
  const root = machineryRoot();
  return root ? `${root}/${relative}` : relative;
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/check_live_tools.ts
var ref = defineScript(import.meta.url);
function main() {
  const defs = machineryPath(AGENT_DEFINITIONS_DIR);
  if (!existsSync(defs)) {
    console.error(`::error::${defs} does not exist, so no agent definition could be checked and a clean pass would mean nothing.`);
    process.exit(2);
  }
  const definitions = readdirSync(defs).filter((entry) => entry.endsWith(".md")).sort();
  if (definitions.length === 0) {
    console.error(`::error::${defs} holds no agent definitions, so nothing was checked.`);
    process.exit(2);
  }
  const work = mkdtempSync(join(tmpdir(), "atomaton-live-tools-"));
  const toolsFile = join(work, "tools.yaml");
  const writer = machineryPath(`${SCRIPTS_DIR}/write_tools_file.ts`);
  const runtimeTools = machineryPath(TOOLS_DIR);
  const wrote = Bun.spawnSync([
    "bun",
    "run",
    writer,
    "--config",
    machineryPath(CONFIG_FILE),
    "--defaults",
    machineryPath(TOOL_DEFAULTS_FILE),
    "--out",
    toolsFile,
    "--hook-base",
    runtimeTools
  ], { stdout: "inherit", stderr: "inherit" });
  if (wrote.exitCode !== 0) {
    console.error("::error::the tools file could not be written, so no server could be started.");
    process.exit(1);
  }
  const atoma = "atoma";
  let failed = 0;
  for (const definition of definitions) {
    console.log(`::group::atoma validate --with-live-tools ${definition}`);
    const { GH_TOKEN: _dropped, ...env } = process.env;
    const result = Bun.spawnSync([atoma, "validate", "--agent-def", `${defs}/${definition}`, "--tools-file", toolsFile, "--with-live-tools"], { stdout: "inherit", stderr: "inherit", env: { ...env, [MACHINERY_ROOT_VAR]: machineryRoot() ?? "." } });
    console.log("::endgroup::");
    if (result.exitCode !== 0)
      failed += 1;
  }
  if (failed > 0) {
    console.error(`::error::${failed} of ${definitions.length} agent definitions have a tool problem a running server reported. ` + "A pattern that matches nothing is a guard that has stopped guarding.");
    process.exit(1);
  }
  console.log(`${definitions.length} agent definition(s) checked against their live tool servers.`);
}
if (import.meta.main)
  main();
export {
  main,
  ref
};

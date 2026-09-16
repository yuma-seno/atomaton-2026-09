#!/usr/bin/env bun
// @bun

// src/scripts/write_tools_file.ts
import { mkdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { dirname as dirname2 } from "path";
import { parseArgs } from "util";

// src/domain/tools-file.ts
import { isAbsolute, join as join2 } from "path";

// src/domain/shipped-servers.ts
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
function defaultPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "atoma-runtime", "tools", "defaults.yaml");
}
var cached;
function toolDefaults(path = defaultPath()) {
  if (cached)
    return cached;
  const parsed = Bun.YAML.parse(readFileSync(path, "utf8"));
  cached = { watch: parsed.watch ?? {}, servers: parsed.servers ?? {} };
  return cached;
}

// src/domain/tools-file.ts
function toolsFileFrom(tools, hookBase, defaultsPath) {
  const out = {};
  const defaults = toolDefaults(defaultsPath);
  const watch = mergedWatch(tools?.watch, defaults);
  if (Object.keys(watch).length > 0)
    out.hooks = absoluteHooks(watch, hookBase);
  for (const [name, server] of Object.entries(mergedServers(tools?.servers, defaults))) {
    const { settings: _delivery, ...forTheCore } = server;
    if (isRecord(forTheCore.hooks))
      forTheCore.hooks = absoluteHooks(forTheCore.hooks, hookBase);
    out[name] = forTheCore;
  }
  return out;
}
function mergedServers(configured, defaults) {
  const out = {};
  for (const [name, server] of Object.entries(defaults.servers)) {
    const { description: _ours, ...rest } = server;
    out[name] = { ...rest };
  }
  for (const [name, server] of Object.entries(configured ?? {})) {
    out[name] = { ...out[name] ?? {}, ...server };
  }
  return out;
}
function mergedWatch(configured, defaults) {
  const out = {};
  for (const [key, scripts] of Object.entries(defaults.watch))
    out[key] = [...scripts];
  for (const [key, added] of Object.entries(configured ?? {})) {
    const theirs = Array.isArray(added) ? added : [added];
    out[key] = [...out[key] ?? [], ...theirs];
  }
  return out;
}
var HOOK_SCRIPT_KEYS = ["before_tool", "after_tool"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function absoluteHooks(hooks, base) {
  const out = { ...hooks };
  for (const key of HOOK_SCRIPT_KEYS) {
    const declared = out[key];
    if (Array.isArray(declared)) {
      out[key] = declared.map((script) => absolutePath(script, base));
    } else if (typeof declared === "string") {
      out[key] = absolutePath(declared, base);
    }
  }
  return out;
}
function absolutePath(script, base) {
  if (typeof script !== "string" || script.length === 0)
    return script;
  if (isAbsolute(script))
    return script;
  return join2(base, script).split("\\").join("/");
}
function reservedServerNames(tools) {
  return Object.keys(tools?.servers ?? {}).filter((name) => name === "hooks");
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

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
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath2(importMetaUrl))}` };
}

// src/scripts/write_tools_file.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: { type: "string" },
      out: { type: "string" },
      "hook-base": { type: "string" },
      defaults: { type: "string" }
    }
  });
  if (!values.config || !values.out || !values["hook-base"] || !values.defaults) {
    console.error("usage: write_tools_file.ts --config config.yaml --defaults defaults.yaml --out tools.yaml --hook-base DIR");
    process.exit(2);
  }
  let tools;
  try {
    const config = Bun.YAML.parse(readFileSync2(values.config, "utf8"));
    tools = config.tools;
  } catch (error) {
    console.error(`::error::${values.config}: could not read the tool servers: ${error.message}`);
    process.exit(1);
  }
  const collisions = reservedServerNames(tools);
  if (collisions.length > 0) {
    console.error(`::error::${values.config}: \`tools.servers\` may not be named ${collisions.join(", ")} \u2014 ` + "`hooks` is the core's reserved key for the hooks that apply to every server, so a server " + "by that name would silently become one.");
    process.exit(1);
  }
  const file = toolsFileFrom(tools, values["hook-base"], values.defaults);
  mkdirSync(dirname2(values.out), { recursive: true });
  writeFileSync(values.out, `# Generated from ${values.config} for this run. Not a file to edit or keep.
` + Bun.YAML.stringify(file, null, 2).replace(/[ \t]+$/gm, ""));
  console.error(`write_tools_file: ${Object.keys(file).length} entries -> ${values.out}`);
}
if (import.meta.main)
  main();
export {
  ref
};

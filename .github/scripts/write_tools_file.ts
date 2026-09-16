#!/usr/bin/env bun
// @bun

// src/scripts/write_tools_file.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { parseArgs } from "util";

// src/domain/tools-file.ts
import { isAbsolute, join } from "path";
function toolsFileFrom(tools, hookBase) {
  const out = {};
  if (tools?.watch && Object.keys(tools.watch).length > 0)
    out.hooks = absoluteHooks(tools.watch, hookBase);
  for (const [name, server] of Object.entries(tools?.servers ?? {})) {
    const { settings: _delivery, ...forTheCore } = server;
    if (isRecord(forTheCore.hooks))
      forTheCore.hooks = absoluteHooks(forTheCore.hooks, hookBase);
    out[name] = forTheCore;
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
    const script = out[key];
    if (typeof script !== "string" || script.length === 0)
      continue;
    if (isAbsolute(script))
      continue;
    out[key] = join(base, script).split("\\").join("/");
  }
  return out;
}
function reservedServerNames(tools) {
  return Object.keys(tools?.servers ?? {}).filter((name) => name === "hooks");
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
var SCRIPTS_RUNTIME_ROOT = ".github/scripts";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_RUNTIME_ROOT}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/write_tools_file.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { config: { type: "string" }, out: { type: "string" }, "hook-base": { type: "string" } }
  });
  if (!values.config || !values.out || !values["hook-base"]) {
    console.error("usage: write_tools_file.ts --config config.yaml --out tools.yaml --hook-base DIR");
    process.exit(2);
  }
  let tools;
  try {
    const config = Bun.YAML.parse(readFileSync(values.config, "utf8"));
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
  const file = toolsFileFrom(tools, values["hook-base"]);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `# Generated from ${values.config} for this run. Not a file to edit or keep.
` + Bun.YAML.stringify(file, null, 2).replace(/[ \t]+$/gm, ""));
  console.error(`write_tools_file: ${Object.keys(file).length} entries -> ${values.out}`);
}
if (import.meta.main)
  main();
export {
  ref
};

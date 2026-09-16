#!/usr/bin/env bun
// @bun

// src/scripts/merge_tool_packages.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
var SCRIPTS_RUNTIME_ROOT = ".github/scripts";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_RUNTIME_ROOT}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/merge_tool_packages.ts
var ref = defineScript(import.meta.url);
var ECOSYSTEMS = ["npm", "bun", "pip"];
function mergePackages(shipped, project) {
  const out = {};
  for (const ecosystem of ECOSYSTEMS) {
    const names = [...shipped[ecosystem] ?? [], ...project[ecosystem] ?? []].filter((name) => typeof name === "string" && name.trim().length > 0).map((name) => name.trim());
    out[ecosystem] = [...new Set(names)];
  }
  return out;
}
function projectPackages(configPath) {
  if (!existsSync(configPath))
    return {};
  try {
    const config = Bun.YAML.parse(readFileSync(configPath, "utf8"));
    return config.tools?.packages ?? {};
  } catch (error) {
    console.error(`::warning::${configPath} could not be read for \`tools.packages\`: ${error.message}`);
    return {};
  }
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { shipped: { type: "string" }, config: { type: "string" }, out: { type: "string" } }
  });
  if (!values.shipped || !values.config || !values.out) {
    console.error("usage: merge_tool_packages.ts --shipped packages.json --config config.yaml --out merged.json");
    process.exit(2);
  }
  let shipped;
  try {
    shipped = JSON.parse(readFileSync(values.shipped, "utf8"));
  } catch (error) {
    console.error(`::error::${values.shipped}: ${error.message}`);
    process.exit(1);
  }
  const merged = mergePackages(shipped, projectPackages(values.config));
  writeFileSync(values.out, JSON.stringify(merged, null, 2) + `
`);
  const total = Object.values(merged).reduce((n, list) => n + list.length, 0);
  console.error(`merge_tool_packages: ${total} package(s) -> ${values.out}`);
}
if (import.meta.main)
  main();
export {
  mergePackages,
  ref
};

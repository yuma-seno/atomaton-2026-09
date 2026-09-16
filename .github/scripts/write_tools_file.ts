#!/usr/bin/env bun
// @bun

// src/scripts/write_tools_file.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { parseArgs } from "util";

// src/domain/tools-file.ts
import { isAbsolute, join } from "path";

// src/domain/shipped-servers.ts
var SHIPPED_SERVERS = {
  filesystem: {
    command: "mcp-server-filesystem",
    args: [
      "."
    ],
    env: {},
    hooks: {
      tool_denylist: [
        "filesystem__directory_tree"
      ],
      after_tool: "./scripts/hooks/note_file_opened.ts"
    }
  },
  filesystem_readonly: {
    command: "mcp-server-filesystem",
    args: [
      "."
    ],
    env: {},
    hooks: {
      tool_allowlist: [
        "filesystem_readonly__read_file",
        "filesystem_readonly__read_multiple_files",
        "filesystem_readonly__read_media_file",
        "filesystem_readonly__list_directory",
        "filesystem_readonly__get_file_info"
      ],
      after_tool: "./scripts/hooks/note_file_opened.ts"
    }
  },
  shell: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/shell.ts"
    ],
    env: {},
    request_timeout_secs: 3600,
    hooks: {
      before_tool: "./scripts/hooks/shell_guard.ts"
    }
  },
  github: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/github.ts"
    ],
    env: {
      GH_TOKEN: "${GH_TOKEN}"
    },
    hooks: {}
  },
  web: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/web.ts"
    ],
    env: {},
    hooks: {}
  },
  search: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/search.ts"
    ],
    env: {
      GH_TOKEN: "${GH_TOKEN}"
    },
    request_timeout_secs: 300,
    hooks: {},
    settings: {
      reranker_model: "onnx-community/bge-reranker-v2-m3-ONNX"
    }
  },
  atoma: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/atoma.ts"
    ],
    env: {
      GH_TOKEN: "${GH_TOKEN}"
    },
    hooks: {}
  },
  atoma_env: {
    command: "bun",
    args: [
      "run",
      "${ATOMA_MACHINERY_ROOT:-.}/.github/atoma/tools/scripts/mcp/atoma.ts"
    ],
    env: {
      GH_TOKEN: "${GH_TOKEN}"
    },
    hooks: {
      tool_allowlist: [
        "atoma_env__reload_environment"
      ]
    }
  }
};
var SHIPPED_WATCH = {
  after_tool: ["./scripts/hooks/workspace_guard.ts"]
};

// src/domain/tools-file.ts
function toolsFileFrom(tools, hookBase) {
  const out = {};
  const watch = mergedWatch(tools?.watch);
  if (Object.keys(watch).length > 0)
    out.hooks = absoluteHooks(watch, hookBase);
  for (const [name, server] of Object.entries(mergedServers(tools?.servers))) {
    const { settings: _delivery, ...forTheCore } = server;
    if (isRecord(forTheCore.hooks))
      forTheCore.hooks = absoluteHooks(forTheCore.hooks, hookBase);
    out[name] = forTheCore;
  }
  return out;
}
function mergedServers(configured) {
  const out = {};
  for (const [name, server] of Object.entries(SHIPPED_SERVERS))
    out[name] = { ...server };
  for (const [name, server] of Object.entries(configured ?? {})) {
    out[name] = { ...out[name] ?? {}, ...server };
  }
  return out;
}
function mergedWatch(configured) {
  const out = {};
  for (const [key, scripts] of Object.entries(SHIPPED_WATCH))
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
  return join(base, script).split("\\").join("/");
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

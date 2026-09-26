#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/check_live_tools.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// src/domain/machinery/effective-tools.ts
var CORE_TOOL_PREFIX = "atoma_builtin__";
var EXACT_TOOL_SETS = [
  {
    server: "files_readonly",
    tools: ["read", "grep", "glob", "list"],
    promise: "files_readonly is the same program as files, and only its tool_allowlist keeps edit and write " + "away from the agents that must not change the tree \u2014 the reviewer."
  },
  {
    server: "atomaton_env",
    tools: ["atomaton_env__reload_environment"],
    promise: "atomaton_env is the atomaton server with its other two tools withheld, so an engineer can rebuild " + "its environment and cannot close its own issue or dispatch another agent."
  }
];
function serverContributed(advertised) {
  return advertised.filter((name) => !name.startsWith(CORE_TOOL_PREFIX));
}
function compareToolSet(expected, advertised) {
  const seen = new Set(serverContributed(advertised));
  const allowed = new Set(expected.tools);
  const unexpected = [...seen].filter((name) => !allowed.has(name)).sort();
  const missing = expected.tools.filter((name) => !seen.has(name));
  if (unexpected.length === 0 && missing.length === 0)
    return;
  return { server: expected.server, unexpected, missing };
}
function describeMismatch(expected, mismatch) {
  const parts = [];
  if (mismatch.unexpected.length > 0) {
    parts.push(`advertises ${mismatch.unexpected.join(", ")}, which it must not`);
  }
  if (mismatch.missing.length > 0) {
    parts.push(`does not advertise ${mismatch.missing.join(", ")}, which it must`);
  }
  return `${expected.server} ${parts.join("; and ")}. Expected exactly {${expected.tools.join(", ")}}. ` + expected.promise;
}

// src/domain/machinery/machinery-layout.ts
var USER_ROOT = ".github/atomaton";
var RUNTIME_ROOT = ".github/atomaton-runtime";
var CONFIG_FILE = `${USER_ROOT}/config.yaml`;
var AGENT_DEFINITIONS_DIR = `${USER_ROOT}/agent-definitions`;
var PROMPT_TEMPLATE = `${USER_ROOT}/prompt-template.md`;
var SKILLS_DIR = `${USER_ROOT}/skills`;
var TOOLS_DIR = `${RUNTIME_ROOT}/tools`;
var TOOL_DEFAULTS_FILE = `${TOOLS_DIR}/defaults.yaml`;
var DELEGATES_DIR = `${TOOLS_DIR}/delegates`;
var TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;
var TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;
var RULESETS_DIR = `${USER_ROOT}/rulesets`;
var SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;
var MACHINERY_ROOT_VAR = "ATOMATON_MACHINERY_ROOT";

// src/adapters/runner/machinery.ts
function machineryRoot() {
  return process.env[MACHINERY_ROOT_VAR]?.trim() || undefined;
}
function machineryPath(relative) {
  const root = machineryRoot();
  return root ? `${root}/${relative}` : relative;
}

// src/entrypoints/machinery/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/check_live_tools.ts
var ref = defineScript(import.meta.url);
function serveStoppingProvider(seen) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      let body = {};
      try {
        body = await request.json();
      } catch {}
      if (Array.isArray(body.messages)) {
        if (seen.completions === 0) {
          for (const tool of body.tools ?? []) {
            const name = tool.function?.name;
            if (name)
              seen.tools.push(name);
          }
        }
        seen.completions += 1;
      }
      return Response.json({
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      });
    }
  });
}
async function advertisedTools(atoma, toolsFile, work, server) {
  const definition = join(work, `${server}-only.md`);
  writeFileSync(definition, [
    "---",
    `name: ${server}-only`,
    "description: Advertises one server's tools and does nothing with them.",
    "provider: openai",
    "model: effective-tool-set-probe",
    "mcp_servers:",
    `  - ${server}`,
    "---",
    "",
    "Say done.",
    ""
  ].join(`
`));
  const prompt = join(work, "prompt.txt");
  writeFileSync(prompt, `Say done.
`);
  const seen = { tools: [], completions: 0 };
  const provider = serveStoppingProvider(seen);
  try {
    const { GH_TOKEN: _dropped, ...env } = process.env;
    const run = Bun.spawn([
      atoma,
      "run",
      "--agent-def",
      definition,
      "--tools-file",
      toolsFile,
      "--prompt-file",
      prompt,
      "--max-iterations",
      "2",
      "--max-runtime-secs",
      "120"
    ], {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...env,
        [MACHINERY_ROOT_VAR]: machineryRoot() ?? ".",
        ATOMA_PROVIDER: "openai",
        OPENAI_API_KEY: "effective-tool-set-probe",
        OPENAI_BASE_URL: `http://127.0.0.1:${provider.port}`
      }
    });
    const exitCode = await run.exited;
    return { tools: seen.tools, exitCode, completions: seen.completions };
  } finally {
    await provider.stop(true);
  }
}
async function checkExactToolSets(atoma, toolsFile, work) {
  const declared = Bun.YAML.parse(readFileSync(toolsFile, "utf8"));
  let failed = 0;
  for (const expected of EXACT_TOOL_SETS) {
    console.log(`::group::the tools ${expected.server} advertises`);
    try {
      if (!(expected.server in declared)) {
        console.error(`::error::${toolsFile} declares no server called '${expected.server}'. ${expected.promise}`);
        failed += 1;
        continue;
      }
      const { tools, exitCode, completions } = await advertisedTools(atoma, toolsFile, work, expected.server);
      if (completions === 0) {
        console.error(`::error::a run naming only '${expected.server}' never reached the model (atoma exited ${exitCode}), ` + "so what that server advertises is unknown and this check has not passed.");
        failed += 1;
        continue;
      }
      if (exitCode !== 0) {
        console.log(`::warning::the run that asked '${expected.server}' what it offers exited ${exitCode} afterwards.`);
      }
      console.log(`${expected.server} advertised: ${tools.join(", ")}`);
      const mismatch = compareToolSet(expected, tools);
      if (mismatch) {
        console.error(`::error::${describeMismatch(expected, mismatch)}`);
        failed += 1;
      }
    } finally {
      console.log("::endgroup::");
    }
  }
  return failed;
}
async function main() {
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
  const wrong = await checkExactToolSets(atoma, toolsFile, work);
  if (wrong > 0) {
    console.error(`::error::${wrong} server(s) do not advertise the tools they are supposed to. The allowlist that ` + "narrows them is the only thing that does, so this is a capability an agent now has.");
    process.exit(1);
  }
  console.log(`${EXACT_TOOL_SETS.length} server(s) advertise exactly the tools they promise.`);
}
if (import.meta.main) {
  main().catch((e) => {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
export {
  main,
  ref
};

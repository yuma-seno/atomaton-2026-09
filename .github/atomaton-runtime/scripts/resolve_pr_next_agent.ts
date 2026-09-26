#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/resolve_pr_next_agent.ts
import { appendFileSync as appendFileSync2 } from "fs";
import { parseArgs } from "util";

// src/adapters/github/gh.ts
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
function ghCommand() {
  const fake = (process.env.ATOMATON_FAKE_GH ?? "").trim();
  return fake ? [process.execPath, fake] : ["gh"];
}
function gh(...args) {
  return run([...ghCommand(), ...args]);
}

// src/entrypoints/machinery/extract_directive.ts
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

// src/domain/work/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);

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

// src/entrypoints/machinery/extract_directive.ts
var ref = defineScript(import.meta.url);
var COMMAND_RE = new RegExp(`^\\/(${AGENT_NAME_PATTERN})$`);
function candidates(rawLine) {
  let line = rawLine.trim();
  if (!line)
    return [];
  line = line.replace(/^(?:[-*+]\s+|>\s*)+/, "");
  const variants = [line];
  if (line.startsWith("`") && line.endsWith("`") && line.length > 2) {
    variants.push(line.slice(1, -1).trim());
  }
  if (line.startsWith("/`") && line.endsWith("`") && line.length > 3) {
    variants.push("/" + line.slice(2, -1).trim());
  }
  return variants;
}
function extractDirective(output, defDir) {
  for (const rawLine of output.split(`
`)) {
    for (const candidate of candidates(rawLine)) {
      const match = COMMAND_RE.exec(candidate);
      if (match) {
        const agent = match[1];
        if (existsSync(join(defDir, `${agent}.md`)))
          return agent;
      }
    }
  }
  return "";
}
if (false)
  ;

// src/entrypoints/machinery/resolve_pr_next_agent.ts
var ref2 = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      "def-dir": { type: "string" }
    }
  });
  const repo = values.repo ?? "";
  const number = values.number ?? "";
  const defDir = values["def-dir"] ?? "";
  if (!repo || !number || !defDir) {
    console.error("usage: resolve_pr_next_agent.ts --repo OWNER/REPO --number N --def-dir DIR");
    process.exit(2);
  }
  const { code, stdout, stderr } = gh("api", `repos/${repo}/pulls/${number}`, "--jq", ".body");
  if (code !== 0) {
    console.error(`::warning::could not read the body of PR #${number}: ${stderr.trim() || `gh exited ${code}`}`);
  }
  const agent = extractDirective(stdout ?? "", defDir);
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput)
    appendFileSync2(githubOutput, `agent=${agent}
`);
  console.error(`PR #${number} asks for: ${agent || "(nobody)"}`);
}
if (import.meta.main)
  main();
export {
  ref2 as ref
};

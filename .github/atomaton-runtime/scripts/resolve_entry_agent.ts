#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/resolve_entry_agent.ts
import { readFileSync, appendFileSync } from "fs";

// src/domain/work/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);
function isAgentName(value) {
  return AGENT_NAME_RE.test(value);
}

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
var DELEGATES_DIR = `${TOOLS_DIR}/delegates`;
var TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;
var TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;
var RULESETS_DIR = `${USER_ROOT}/rulesets`;
var SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;

// src/entrypoints/machinery/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/resolve_entry_agent.ts
var ref = defineScript(import.meta.url);
function commandLine(body) {
  for (const raw of body.split(`
`)) {
    const line = raw.trim();
    if (!line)
      continue;
    if (line.startsWith("<!--") && line.endsWith("-->"))
      continue;
    return line;
  }
  return "";
}
function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const number = process.env.NUMBER ?? "";
  const sender = process.env.SENDER ?? "";
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!eventPath) {
    console.error("resolve_entry_agent: GITHUB_EVENT_PATH is not set");
    return;
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const body = event.issue?.body ?? "";
  if (!commandLine(body).startsWith("/"))
    return;
  const agent = commandLine(body).slice(1).trim();
  if (!agent)
    return;
  if (!isAgentName(agent)) {
    console.error(`::warning::Ignoring '/${agent}': an agent command must be a bare name on its own line ` + `(for example '/engineer'), with any instructions on the lines after it.`);
    return;
  }
  if (githubOutput) {
    appendFileSync(githubOutput, [`agent=${agent}`, `number=${number}`, "type=issue", `notify=${sender}`].join(`
`) + `
`);
  }
}
if (import.meta.main)
  main();
export {
  ref
};

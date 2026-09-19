#!/usr/bin/env bun
// @bun

// src/scripts/resolve_resume_agent.ts
import { appendFileSync } from "fs";
import { parseArgs } from "util";

// src/lib/gh.ts
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
function gh(...args) {
  return run(["gh", ...args]);
}

// src/lib/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);

// src/lib/tags.ts
var TAG_PREFIX = `atomaton:`;
var EVERY_TAG_PATTERN = [];
function makeTag(key, valuePattern, parse, render) {
  const pattern = `<!--\\s*${TAG_PREFIX}${key}=(?:${valuePattern})\\s*-->`;
  EVERY_TAG_PATTERN.push(pattern);
  const re = new RegExp(`<!--\\s*${TAG_PREFIX}${key}=(${valuePattern})\\s*-->`);
  return {
    write: (value) => `<!-- ${TAG_PREFIX}${key}=${render(value)} -->`,
    read: (text) => {
      const m = re.exec(text);
      return m ? parse(m[1]) : undefined;
    },
    has: (text) => re.test(text),
    search: (value) => `${TAG_PREFIX}${key}=${render(value)}`
  };
}
function numericTag(key) {
  return makeTag(key, "\\d+", Number, String);
}
function stringTag(key, valuePattern) {
  return makeTag(key, valuePattern, (raw) => raw, (value) => value);
}
var STOP_TAG = stringTag("stop", "requested");
var ENDED_TAG = stringTag("ended", "stopped|limit|done");
var PARENT_TAG = numericTag("parent");
var PARENT_ISSUE_TAG = numericTag("parent-issue");
var NOTIFY_TAG = stringTag("notify", "[A-Za-z0-9-]+");
var ORIGIN_AGENT_TAG = stringTag("origin-agent", AGENT_NAME_PATTERN);
var DISPATCH_TAG = stringTag("dispatch", AGENT_NAME_PATTERN);
var AGENT_TAG = stringTag("agent", AGENT_NAME_PATTERN);
var CHANGED_TAG = stringTag("changed", "yes|no");
var LLM_CONTEXT_TAG = stringTag("llm-context", "include|exclude");
var AGGREGATED_TAG = numericTag("aggregated");
var SUB_RESULT_TAG = numericTag("sub-result");
var CI_RETRY_TAG = numericTag("ci-retry");

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";

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

// src/scripts/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/resolve_resume_agent.ts
var ref = defineScript(import.meta.url);
function mostRecentAgent(bodies) {
  for (let i = bodies.length - 1;i >= 0; i--) {
    const agent = AGENT_TAG.read(bodies[i] ?? "");
    if (agent)
      return agent;
  }
  return "";
}
function mostRecentAgentOn(repo, number) {
  const { code, stdout } = gh("api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[].body]");
  if (code !== 0)
    return "";
  try {
    return mostRecentAgent(JSON.parse(stdout || "[]"));
  } catch {
    return "";
  }
}
function main() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { number: { type: "string" } } });
  if (!values.number) {
    console.error("usage: resolve_resume_agent.ts --number N");
    process.exit(2);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const { code, stdout, stderr } = gh("api", `repos/${repo}/issues/${values.number}/comments`, "--paginate", "--jq", "[.[].body]");
  let agent = "";
  if (code === 0) {
    try {
      agent = mostRecentAgent(JSON.parse(stdout || "[]"));
    } catch {
      agent = "";
    }
  } else {
    console.error(`Could not read comments on #${values.number}: ${stderr || stdout}`);
  }
  if (!agent) {
    gh("issue", "comment", String(values.number), "--repo", repo, "--body", [
      LLM_CONTEXT_TAG.write("exclude"),
      "Atomaton: `/resume` found no previous run on this issue to continue. Use `/<agent>` to start one."
    ].join(`
`));
  }
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput)
    appendFileSync(githubOutput, `agent=${agent}
`);
  console.error(agent ? `Resuming ${agent}` : "Nothing to resume");
}
if (import.meta.main)
  main();
export {
  mostRecentAgent,
  mostRecentAgentOn,
  ref
};

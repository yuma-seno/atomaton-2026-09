#!/usr/bin/env bun
// @bun

// src/scripts/stop_on_close.ts
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

// src/lib/config.ts
import { readFileSync } from "fs";

// src/domain/merge-readiness.ts
var CI_WOULD_BE_WASTED = new Set([
  "not-open",
  "draft",
  "conflicting",
  "behind",
  "mergeability-unknown",
  "checks-pending",
  "checks-failing"
]);
var PASSING = new Set(["success", "neutral", "skipped"]);

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

// src/lib/config.ts
function configPath() {
  const root = process.env.ATOMATON_MACHINERY_ROOT?.trim();
  return root ? `${root}/${CONFIG_FILE}` : CONFIG_FILE;
}
var cached;
function loadConfig() {
  if (!cached) {
    cached = Bun.YAML.parse(readFileSync(configPath(), "utf8"));
  }
  return cached;
}
var DEFAULT_LABELS = {
  sub_issue: "atomaton/sub-issue",
  launched: "atomaton/launched",
  in_progress: "atomaton/in-progress"
};
function getLabel(key) {
  return loadConfig().chain?.labels?.[key] ?? DEFAULT_LABELS[key];
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
    has: (text) => re.test(text)
  };
}
function numericTag(key) {
  return makeTag(key, "\\d+", Number, String);
}
function stringTag(key, valuePattern) {
  return makeTag(key, valuePattern, (raw) => raw, (value) => value);
}
var STOP_TAG = stringTag("stop", "requested");
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

// src/lib/running-children.ts
function runningChildren(repo, parent) {
  const label = getLabel("in_progress");
  const { code, stdout } = gh("issue", "list", "--repo", repo, "--state", "open", "--limit", "200", "--search", `atomaton:parent=${parent} in:body`, "--label", label, "--json", "number,body");
  if (code !== 0)
    return [];
  try {
    const issues = JSON.parse(stdout || "[]");
    return issues.filter((i) => PARENT_TAG.read(i.body ?? "") === parent).map((i) => i.number);
  } catch {
    return [];
  }
}

// src/domain/closed-issue.ts
function stopOnCloseNotice(number) {
  return [
    "Atomaton: this issue was closed while an agent was working on it, so the run has been asked to stop.",
    "",
    "Closing does not stop a run by itself \u2014 it kept going until this request reached it. The run stops after its current step, so it may take a minute.",
    "",
    `#${number} stays closed, and the run will report here when it has stopped.`
  ].join(`
`);
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/stop_on_close.ts
var ref = defineScript(import.meta.url);
function stopOnCloseBody(number, children) {
  const lines = [LLM_CONTEXT_TAG.write("exclude"), STOP_TAG.write("requested"), stopOnCloseNotice(number)];
  if (children.length > 0) {
    lines.push("", `Work is also running on ${children.map((n) => `#${n}`).join(", ")}. ` + "Closing this issue does not reach those \u2014 comment `/stop` on each one you want stopped.");
  }
  return lines.join(`
`);
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      closer: { type: "string" },
      "closer-type": { type: "string" }
    }
  });
  if (!values.number) {
    console.error("usage: stop_on_close.ts --number N --closer LOGIN [--closer-type Bot|User]");
    process.exit(2);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const number = String(values.number);
  const closer = (values.closer ?? "").trim();
  if ((values["closer-type"] ?? "").trim() === "Bot") {
    console.error(`#${number} was closed by a bot, which is how an agent finishes its own work. Nothing to stop.`);
    return;
  }
  const { code, stdout, stderr } = gh("api", `repos/${repo}/issues/${number}`);
  if (code !== 0) {
    console.error(`::error::Could not read #${number}, so this cannot tell whether a run is in progress: ${stderr || stdout}`);
    process.exit(1);
  }
  let issue;
  try {
    issue = JSON.parse(stdout);
  } catch {
    console.error(`::error::Could not parse the response for #${number}.`);
    process.exit(1);
  }
  const label = getLabel("in_progress");
  const inProgress = (issue.labels ?? []).some((l) => l.name === label);
  if (!inProgress) {
    console.error(`#${number} carries no '${label}' label, so no run is working on it. Nothing to stop.`);
    return;
  }
  const children = runningChildren(repo, Number(number));
  const posted = gh("issue", "comment", number, "--repo", repo, "--body", stopOnCloseBody(Number(number), children));
  if (posted.code !== 0) {
    console.error(`::error::Could not post the stop request on #${number}: ${posted.stderr || posted.stdout}`);
    process.exit(1);
  }
  console.error(`#${number} was closed by ${closer || "(unknown)"} while a run held '${label}'. Stop requested` + `${children.length ? `; children still running: ${children.join(", ")}` : ""}.`);
}
if (import.meta.main)
  main();
export {
  ref,
  stopOnCloseBody
};

#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/report_config_findings.ts
import { existsSync, readFileSync } from "fs";
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

// src/domain/work/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);

// src/adapters/github/tags.ts
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

// src/entrypoints/machinery/report_config_findings.ts
var ref = defineScript(import.meta.url);
var FINDING_PREFIX = "ATOMA_CONFIG_FINDING:";
function findingMarker(fields) {
  const hash = new Bun.CryptoHasher("sha256").update(fields).digest("hex").slice(0, 16);
  return `<!-- atomaton:config-finding=${hash} -->`;
}
function findingsIn(log) {
  const found = [];
  for (const line of log.split(`
`)) {
    const at = line.indexOf(FINDING_PREFIX);
    if (at === -1)
      continue;
    const fields = line.slice(at + FINDING_PREFIX.length).trim();
    if (fields)
      found.push(fields);
  }
  return [...new Set(found)];
}
function findingTitle(fields) {
  const kind = /kind=(\S+)/.exec(fields)?.[1] ?? "unknown";
  const subject = /(?:server|tool)=(\S+)/.exec(fields)?.[1] ?? "";
  return subject ? `Config finding: ${kind} (${subject})` : `Config finding: ${kind}`;
}
function log(message) {
  console.error(`[config-findings] ${message}`);
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      "logs-file": { type: "string" },
      agent: { type: "string" }
    }
  });
  const repo = values.repo ?? "";
  const logsFile = values["logs-file"] ?? "";
  const agent = (values.agent ?? "").trim();
  if (!repo || !logsFile) {
    console.error("usage: report_config_findings.ts --repo OWNER/REPO --logs-file FILE --agent NAME");
    process.exit(2);
  }
  if (!existsSync(logsFile)) {
    log(`no log at ${logsFile}; nothing to report`);
    return;
  }
  const findings = findingsIn(readFileSync(logsFile, "utf8"));
  if (findings.length === 0) {
    log("no configuration findings");
    return;
  }
  log(`${findings.length} finding(s)`);
  if (!agent) {
    console.error("::error::a configuration finding was reported but `agents.on_config_finding` is unset, " + "so no agent could be started. Set it in .github/atomaton/config.yaml.");
    process.exit(1);
  }
  for (const fields of findings) {
    const marker = findingMarker(fields);
    const existing = gh("issue", "list", "--repo", repo, "--state", "open", "--search", marker, "--json", "number", "--jq", ".[0].number");
    if (existing.code === 0 && existing.stdout.trim()) {
      log(`#${existing.stdout.trim()} already reports this finding; leaving it alone`);
      continue;
    }
    const body = [
      marker,
      "`atoma` found this defect in the tools file it was handed, reported it, and carried on.",
      "",
      "```",
      `${FINDING_PREFIX} ${fields}`,
      "```",
      "",
      "The fields are the contract and the sentence beside them is not, so this is the whole",
      "report. What each field means is in the core's own documentation.",
      "",
      "The run was not stopped, because stopping would not close a guard that has stopped",
      "guarding -- it would only remove the agent's ability to repair the configuration."
    ].join(`
`);
    const created = gh("issue", "create", "--repo", repo, "--title", findingTitle(fields), "--body", body);
    if (created.code !== 0) {
      console.error(`::warning::could not open an issue for this finding: ${created.stderr.trim()}`);
      continue;
    }
    const number = created.stdout.trim().split("/").pop() ?? "";
    log(`opened #${number} for ${fields}`);
    const asked = gh("issue", "comment", number, "--repo", repo, "--body", `${LLM_CONTEXT_TAG.write("include")}
/${agent}

Repair the configuration defect reported above.`);
    if (asked.code !== 0) {
      console.error(`::warning::opened #${number} but could not start ${agent} on it: ${asked.stderr.trim()}`);
    }
  }
}
if (import.meta.main)
  main();
export {
  findingMarker,
  findingTitle,
  findingsIn,
  ref
};

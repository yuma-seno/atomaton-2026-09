#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/manage_dispatch_loop.ts
import { appendFileSync } from "fs";
import { parseArgs } from "util";

// src/domain/work/dispatch-chain.ts
var DEFAULT_HANDOFF_LIMIT = 5;
function isPerson(comment) {
  return comment.authorType === "User";
}
function handoffsSincePerson(comments, isAgentComment) {
  let handoffs = 0;
  for (let i = comments.length - 1;i >= 0; i--) {
    const comment = comments[i];
    if (isPerson(comment))
      break;
    if (isAgentComment(comment.body ?? ""))
      handoffs++;
  }
  return handoffs;
}
function resolveHandoffLimit(configured) {
  const value = typeof configured === "number" ? configured : Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_HANDOFF_LIMIT;
}

// src/domain/work/progress.ts
var DEFAULT_NO_PROGRESS_LIMIT = 2;
function runsWithoutChange(comments, isNoChangeResult) {
  let runs = 0;
  for (let i = comments.length - 1;i >= 0; i--) {
    if (!isNoChangeResult(comments[i]?.body ?? ""))
      break;
    runs++;
  }
  return runs;
}
function noProgressLimitReached(runs, limit) {
  return runs >= limit;
}
function resolveNoProgressLimit(configured) {
  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_NO_PROGRESS_LIMIT;
}
function counted(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function stopReason(counts) {
  if (noProgressLimitReached(counts.runsWithoutChange, counts.noProgressLimit)) {
    return {
      stop: true,
      reason: `The last ${counted(counts.runsWithoutChange, "agent run")} changed nothing \u2014 no commit was pushed by any of them ` + `(limit ${counts.noProgressLimit}). Repeating a run that changes nothing is unlikely to start changing something, ` + `so the next automatic handoff has been withheld.`
    };
  }
  if (counts.handoffs >= counts.handoffLimit) {
    return {
      stop: true,
      reason: `Auto-dispatch loop limit reached: ${counted(counts.handoffs, "agent handoff")} since anyone else commented ` + `(limit ${counts.handoffLimit}). To prevent unintended infinite agent loops and excessive API costs, ` + `the next automatic handoff has been withheld.`
    };
  }
  return { stop: false };
}

// src/adapters/runner/config.ts
import { readFileSync } from "fs";

// src/domain/delivery/merge-readiness.ts
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

// src/domain/delivery/declared-secrets.ts
var RUN_CREDENTIALS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ORCAROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ATOMA_COPILOT_TOKEN",
  "GH_TOKEN"
];
var AGENT_ENV_NAMES = [
  "HOME",
  "PATH",
  "AGENT",
  MACHINERY_ROOT_VAR,
  "GITHUB_REPOSITORY",
  "BRANCH",
  "ISSUE_NUMBER",
  "ISSUE_NOTIFY",
  "ATOMATON_RUN_TYPE",
  "ATOMATON_RELOAD_COUNT",
  "ATOMATON_OPS_LOG",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "BUN_INSTALL_CACHE_DIR",
  "npm_config_cache",
  "PIP_CACHE_DIR",
  "CARGO_HOME",
  "OPENAI_BASE_URL",
  "ATOMA_PROVIDER"
];
var RUN_STEP_NAMES = [
  "GITHUB_RUN_ID",
  "OPENROUTER_BASE_URL",
  "ORCAROUTER_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "COPILOT_BASE_URL",
  "ATOMA_PROVIDER_IN",
  "OPENAI_BASE_URL_IN"
];
var TOOL_SECRETS = {
  field: "tools.secrets",
  reserved: new Set([...RUN_CREDENTIALS, ...AGENT_ENV_NAMES, ...RUN_STEP_NAMES])
};
var JOB_ENV = ["ATOMATON_COMMANDS", "GH_TOKEN"];
var CHECK_JOB_RESERVED = new Set([...JOB_ENV, "ATOMATON_PR_TREE"]);
var DEPLOY_JOB_RESERVED = new Set([...JOB_ENV, "ATOMATON_DEPLOY_TARGET"]);

// src/domain/delivery/check-jobs.ts
var CHECKS_FROM_PULL_REQUEST = {
  where: "checks.from_pull_request",
  secrets: {
    refused: "These commands come from the pull request, which may rewrite them, so a credential " + "named beside them is one the change being judged can read. Move the check to " + "`checks.from_default_branch`, where the commands come from a branch a person approved."
  }
};
var NO_PULL_REQUEST_CHECKS = "This check verified nothing: `checks.from_pull_request` in .github/atomaton/config.yaml is empty, " + "so a pull request satisfying it has not been tested. Add the commands that check this project, " + "or point `checks.your_workflow` at a workflow of your own.";

// src/adapters/runner/machinery.ts
function machineryRoot() {
  return process.env[MACHINERY_ROOT_VAR]?.trim() || undefined;
}
function machineryPath(relative) {
  const root = machineryRoot();
  return root ? `${root}/${relative}` : relative;
}

// src/adapters/runner/config.ts
function configPath() {
  return machineryPath(CONFIG_FILE);
}
var cached;
function loadConfig() {
  if (!cached) {
    cached = Bun.YAML.parse(readFileSync(configPath(), "utf8"));
  }
  return cached;
}
function getHandoffLimit() {
  return loadConfig().chain?.after_handoffs;
}
function getNoProgressLimit() {
  return loadConfig().chain?.after_runs_without_change;
}

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
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/manage_dispatch_loop.ts
var ref = defineScript(import.meta.url);
function readComments(repo, number) {
  const { code, stdout } = gh("api", `repos/${repo}/issues/${number}/comments?per_page=100`, "--paginate", "--jq", ".[] | {authorType: .user.type, body: .body}");
  if (code)
    return { comments: [], read: false };
  const comments = [];
  for (const line of stdout.split(`
`)) {
    if (!line.trim())
      continue;
    try {
      comments.push(JSON.parse(line));
    } catch {
      console.error(`  Skipping an unparseable comment line`);
    }
  }
  return { comments, read: true };
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      repo: { type: "string" }
    }
  });
  const number = values.number ?? "";
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!number || !repo) {
    console.error("usage: manage_dispatch_loop.ts --number N [--repo owner/name]");
    process.exit(2);
  }
  const limit = resolveHandoffLimit(getHandoffLimit());
  const noProgressLimit = resolveNoProgressLimit(getNoProgressLimit());
  const { comments, read } = readComments(repo, number);
  if (!read)
    console.error(`WARN could not read comments on ${repo}#${number}; treating the chain as fresh`);
  const handoffs = handoffsSincePerson(comments, (body) => AGENT_TAG.has(body));
  const stalled = runsWithoutChange(comments, (body) => AGENT_TAG.has(body) && CHANGED_TAG.read(body) === "no");
  const decision = stopReason({
    handoffs,
    handoffLimit: limit,
    runsWithoutChange: stalled,
    noProgressLimit
  });
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `auto_dispatch_count=${handoffs}
` + `loop_limit_reached=${decision.stop}
` + `handoff_limit=${limit}
` + `runs_without_change=${stalled}
` + `stop_reason=${decision.reason ?? ""}
`);
  }
  console.error(`Agent handoffs since a person last commented: ${handoffs}/${limit}; ` + `consecutive runs that changed nothing: ${stalled}/${noProgressLimit} (stop=${decision.stop})`);
}
if (import.meta.main)
  main();
export {
  ref
};

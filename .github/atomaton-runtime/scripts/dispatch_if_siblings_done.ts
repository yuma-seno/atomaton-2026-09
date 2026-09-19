#!/usr/bin/env bun
// @bun

// src/scripts/dispatch_if_siblings_done.ts
import { parseArgs } from "util";

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
function ghRead(...args) {
  let result = gh(...args);
  for (const delay of [2000, 6000]) {
    if (result.code === 0 || !looksTransient(result))
      return result;
    console.error(`::warning::gh ${args.slice(0, 2).join(" ")} failed transiently, retrying: ${result.stderr || result.stdout}`);
    Bun.sleepSync(delay);
    result = gh(...args);
  }
  return result;
}
function looksTransient(result) {
  const text = `${result.stderr} ${result.stdout}`;
  if (/HTTP (429|5[0-9][0-9])(?![0-9])/.test(text))
    return true;
  return /(timeout|timed out|connection reset|unexpected EOF|TLS handshake|temporary failure)/i.test(text);
}
function dispatchWorkflow(context, workflow, args = [], log = (m) => console.error(m)) {
  const { code, stdout, stderr } = gh("workflow", "run", workflow, ...args);
  if (code) {
    log(`${context}: WARN failed to dispatch ${workflow}: ${stderr || stdout}`);
    return false;
  }
  log(`${context}: dispatched ${workflow}`);
  return true;
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
function readAnyParentTag(text) {
  return PARENT_TAG.read(text) ?? PARENT_ISSUE_TAG.read(text);
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

// src/lib/sibling-check.ts
function countOpenSiblings(opts) {
  const label = opts.label || getLabel("sub_issue");
  const launchedLabel = opts.launchedLabel || getLabel("launched");
  const { code, stdout, stderr } = gh("issue", "list", "--repo", opts.repo, "--state", "open", "--label", label, "--label", launchedLabel, "--search", `${PARENT_TAG.search(opts.parent)} in:body`, "--json", "number");
  if (code !== 0) {
    throw new Error(`countOpenSiblings: gh issue list failed: ${stderr}`);
  }
  const siblings = stdout ? JSON.parse(stdout) : [];
  const remaining = opts.exclude !== undefined ? siblings.filter((s) => s.number !== opts.exclude) : siblings;
  return remaining.length;
}

// src/lib/ops-log.ts
import { appendFileSync } from "fs";
var OPS_LOG_PATH = process.env.ATOMATON_OPS_LOG ?? "/tmp/atomaton_ops.log";
function logOp(op, payload = {}) {
  const entry = { ts: new Date().toISOString(), op, ...payload };
  try {
    appendFileSync(OPS_LOG_PATH, JSON.stringify(entry) + `
`);
  } catch (e) {
    console.error(`[ops-log] WARN: failed to write op log: ${e}`);
  }
}
function logDispatch(target, agent, extra = {}) {
  logOp("dispatch", { target, agent, ...extra });
}

// src/lib/target-state.ts
function readTargetState(number, repo) {
  const path = repo ? `repos/${repo}/issues/${number}` : `repos/{owner}/{repo}/issues/${number}`;
  const { code, stdout, stderr } = ghRead("api", path);
  if (code !== 0) {
    return { kind: "unknown", why: (stderr || stdout || `gh exited ${code}`).trim().split(`
`)[0] ?? "" };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "unknown", why: "the response was not JSON" };
  }
  if (parsed.state === "open")
    return { kind: "open" };
  if (parsed.state === "closed")
    return { kind: "closed", merged: Boolean(parsed.pull_request?.merged_at) };
  return { kind: "unknown", why: `unrecognised state ${JSON.stringify(parsed.state ?? null)}` };
}

// src/domain/closed-issue.ts
function mayStartWorkOn(state) {
  return state.kind === "open";
}
function recoveryAdvice(state, number, command) {
  if (state.kind === "closed" && state.merged) {
    return `#${number} is merged, and GitHub cannot reopen a merged pull request. ` + `Open an issue for the follow-up instead.`;
  }
  return `Reopen #${number} and comment \`${command}\` to run it.`;
}
function mentionPrefix(logins) {
  return logins.length > 0 ? `${logins.map((l) => `@${l}`).join(" ")} ` : "";
}
function dispatchRefusedNotice(refused) {
  const { agent, number, context, state, notify } = refused;
  const why = state.kind === "unknown" ? `the state of #${number} could not be read (${state.why})` : `#${number} is closed`;
  return [
    `${mentionPrefix(notify ? [notify] : [])}Atomaton: \`${agent}\` was not started on #${number}, because ${why}.`,
    "",
    `What was about to happen: ${context}.`,
    "",
    "Nothing will retry this.",
    "",
    state.kind === "unknown" ? `Start it by hand once #${number} can be read: comment \`/${agent}\` on it.` : recoveryAdvice(state, number, `/${agent}`)
  ].join(`
`);
}

// src/lib/dispatch.ts
function runnerWorkflow() {
  return process.env.ATOMATON_DISPATCH_WORKFLOW || "atomaton-runner.yml";
}
function refuseClosedTarget(d, state) {
  const log = d.log ?? ((message) => console.error(message));
  const body = dispatchRefusedNotice({
    agent: d.agent,
    number: Number(d.number),
    context: d.context,
    state,
    notify: d.notify ?? ""
  });
  const { code, stdout, stderr } = gh("issue", "comment", String(d.number), ...d.repo ? ["--repo", d.repo] : [], "--body", body);
  if (code !== 0) {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open), and could not post the notice: ${stderr || stdout}`);
  } else {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open); notice posted`);
  }
  return "refused-closed";
}
function dispatchRunner(d) {
  const state = readTargetState(d.number, d.repo);
  if (!mayStartWorkOn(state))
    return refuseClosedTarget(d, state);
  const args = [
    ...d.repo ? ["--repo", d.repo] : [],
    "--field",
    `agent=${d.agent}`,
    "--field",
    `number=${d.number}`,
    "--field",
    `type=${d.type}`,
    "--field",
    `notify=${d.notify ?? ""}`,
    "--field",
    `reload_count=${d.reloadCount ?? 0}`
  ];
  if (!dispatchWorkflow(d.context, runnerWorkflow(), args, d.log))
    return "failed";
  logDispatch(d.type, d.agent, { number: Number(d.number) });
  return "dispatched";
}

// src/lib/notify.ts
function log(message) {
  console.error(`[atomaton-notify] ${message}`);
}
var MAX_HOPS = 10;
function repositoryOwner(repo) {
  const owner = repo.split("/")[0]?.trim() ?? "";
  if (!owner)
    log(`WARN could not read an owner out of ${JSON.stringify(repo)}; nobody will be mentioned`);
  return owner;
}
function fetchIssueLookup(repo, number) {
  const { code, stderr, stdout } = gh("api", `repos/${repo}/issues/${number}`, "--jq", "{body: .body, login: .user.login, type: .user.type}");
  if (code !== 0 || !stdout.trim()) {
    log(`WARN could not read issue #${number} to resolve a mention: ${stderr.trim() || `gh exited ${code}`}`);
    return {};
  }
  try {
    return JSON.parse(stdout);
  } catch {
    log(`WARN issue #${number} lookup was not valid JSON; no mention will be resolved from it`);
    return {};
  }
}
function resolveNotify(repo, number) {
  const visited = new Set;
  let current = number;
  for (let i = 0;i < MAX_HOPS; i++) {
    if (visited.has(current))
      break;
    visited.add(current);
    const d = fetchIssueLookup(repo, current);
    const body = d.body ?? "";
    const tagged = NOTIFY_TAG.read(body);
    if (tagged)
      return tagged;
    if ((d.type ?? "").toLowerCase() === "user" && d.login) {
      return d.login;
    }
    const parent = readAnyParentTag(body);
    if (parent === undefined)
      break;
    current = parent;
  }
  const owner = repositoryOwner(repo);
  if (owner)
    log(`no requester found for #${number}; falling back to the repository owner @${owner}`);
  return owner;
}

// src/lib/aggregation.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function needsAttention(result) {
  return result.kind === "dispatch-failed" || result.kind === "undetermined" || result.kind === "parent-closed";
}
function describeGateResult(result, closedNum, parent) {
  const which = parent === undefined ? "the parent issue" : `#${parent}`;
  switch (result.kind) {
    case "not-tracked":
      return `#${closedNum} is not a tracked sub-issue; nothing to aggregate.`;
    case "waiting":
      return `${result.remaining} sibling(s) of ${which} still open. No action needed.`;
    case "already-aggregated":
      return `Another caller already aggregated #${closedNum}. Nothing to do -- this is the normal race.`;
    case "dispatched":
      return `All sub-tasks of ${which} complete. Orchestrator re-invoked.`;
    case "dispatch-failed":
      return `All sub-tasks of ${which} complete, but the orchestrator dispatch FAILED. ` + `The aggregation marker is already written, so no other caller will retry: ` + `re-run the orchestrator by hand.`;
    case "parent-closed":
      return `All sub-tasks of ${which} complete, but ${which} is closed, so no orchestrator was started. ` + `The aggregation marker is already written, so no other caller will retry: ` + `reopen it and run the orchestrator by hand. Whoever asked for the run has been told on the issue.`;
    case "undetermined":
      return `Did not aggregate #${closedNum}: ${result.why}. Nothing was dispatched, and nothing will retry.`;
  }
}
async function dispatchOrchestratorIfReady(opts) {
  const excludeNum = opts.exclude ? opts.closedNum : undefined;
  const count = () => countOpenSiblings({ repo: opts.repo, parent: opts.parent, exclude: excludeNum });
  let remaining;
  try {
    remaining = count();
    if (opts.retry) {
      for (let attempt = 1;remaining > 0 && attempt < 4; attempt++) {
        await sleep(2000 * attempt);
        remaining = count();
      }
    }
  } catch (error) {
    const why = `could not count #${opts.parent}'s open sub-issues: ${error.message}`;
    console.error(why);
    return { kind: "undetermined", why };
  }
  if (remaining > 0) {
    if (opts.progressMessage) {
      gh("issue", "comment", String(opts.parent), "--repo", opts.repo, "--body", `${LLM_CONTEXT_TAG.write("exclude")}
${SUB_RESULT_TAG.write(opts.closedNum)}
${opts.progressMessage(remaining)}`);
    }
    return { kind: "waiting", remaining };
  }
  const { code: commentsCode, stdout: commentsOut } = gh("issue", "view", String(opts.parent), "--repo", opts.repo, "--json", "comments", "--jq", ".comments[].body");
  if (commentsCode !== 0) {
    const why = `could not read #${opts.parent}'s comments, so this cannot tell whether the aggregation already ran`;
    console.error(`${why}; not dispatching`);
    return { kind: "undetermined", why };
  }
  if (commentsOut.includes(AGGREGATED_TAG.write(opts.closedNum))) {
    return { kind: "already-aggregated" };
  }
  if (opts.beforeDispatch)
    await opts.beforeDispatch();
  const marker = gh("issue", "comment", String(opts.parent), "--repo", opts.repo, "--body", `${AGGREGATED_TAG.write(opts.closedNum)}
Atomaton: All sub-tasks completed (last: #${opts.closedNum}). Re-invoking orchestrator for aggregation.`);
  if (marker.code !== 0) {
    const why = `could not write the aggregation marker on #${opts.parent}: ${marker.stderr.trim() || marker.stdout.trim()}`;
    console.error(`${why}; not dispatching, because without the marker a second caller would dispatch too`);
    return { kind: "undetermined", why };
  }
  const outcome = dispatchRunner({
    context: `all sub-issues of #${opts.parent} are complete, so its orchestrator was to be re-invoked`,
    agent: "orchestrator",
    type: "issue",
    number: opts.parent,
    notify: resolveNotify(opts.repo, opts.parent),
    repo: opts.repo
  });
  if (outcome === "dispatched")
    return { kind: "dispatched" };
  return outcome === "refused-closed" ? { kind: "parent-closed" } : { kind: "dispatch-failed" };
}

// src/scripts/dispatch_if_siblings_done.ts
var ref = defineScript(import.meta.url);
async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      parent: { type: "string" },
      "closed-num": { type: "string" }
    }
  });
  if (!values.repo || !values.parent || !values["closed-num"]) {
    console.error("usage: dispatch_if_siblings_done.ts --repo OWNER/REPO --parent N --closed-num N");
    process.exit(2);
  }
  const { repo, parent } = values;
  const closedNum = values["closed-num"];
  console.log("Sub-issue closed manually. Checking open siblings...");
  const result = await dispatchOrchestratorIfReady({
    repo,
    parent: Number(parent),
    closedNum: Number(closedNum)
  });
  console.log(describeGateResult(result, Number(closedNum), Number(parent)));
  if (needsAttention(result))
    process.exit(1);
}
if (import.meta.main)
  main();
export {
  ref
};

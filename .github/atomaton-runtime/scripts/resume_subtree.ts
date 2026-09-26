#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/resume_subtree.ts
import { parseArgs } from "util";

// src/domain/work/work-tree.ts
var MAX_DEPTH = 10;
function subtree(nodes, root) {
  const byParent = new Map;
  const byNumber = new Map;
  for (const node of nodes) {
    byNumber.set(node.number, node);
    if (node.parent === undefined)
      continue;
    const siblings = byParent.get(node.parent) ?? [];
    siblings.push(node);
    byParent.set(node.parent, siblings);
  }
  const start = byNumber.get(root);
  if (!start)
    return [];
  const found = [start];
  const seen = new Set([root]);
  let frontier = [root];
  for (let depth = 0;depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      for (const child of byParent.get(parent) ?? []) {
        if (seen.has(child.number))
          continue;
        seen.add(child.number);
        found.push(child);
        next.push(child.number);
      }
    }
    frontier = next;
  }
  return found;
}
function resumeCandidates(nodes) {
  return nodes.filter((node) => node.state === "open" && !node.running);
}
function nodesToResume(candidates, stoppedLast) {
  return candidates.filter((node) => stoppedLast.has(node.number));
}
function descendants(nodes, root) {
  return nodes.filter((node) => node.number !== root);
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
function graphqlArgs(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-F", `${key}=${value}`);
  }
  return args;
}
function graphqlResult({ code, stdout, stderr }) {
  if (code !== 0) {
    throw new Error(`GraphQL query failed: ${stderr || stdout.slice(0, 200)}`);
  }
  const result = JSON.parse(stdout);
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}
function ghGraphqlRead(query, variables = {}) {
  return graphqlResult(ghRead(...graphqlArgs(query, variables)));
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

// src/adapters/runner/ops-log.ts
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

// src/adapters/github/outcome.ts
function issueOutcome(reason) {
  const said = (reason ?? "").toLowerCase();
  return said === "not_planned" || said === "duplicate" ? "abandoned" : "done";
}
function pullRequestOutcome(merged) {
  return merged ? "done" : "abandoned";
}
function saysOpen(state) {
  return (state ?? "").toLowerCase() === "open";
}

// src/adapters/github/target-state.ts
function readTargetState(number, repo) {
  const path = repo ? `repos/${repo}/issues/${number}` : `repos/{owner}/{repo}/issues/${number}`;
  const { code, stdout, stderr } = ghRead("api", path);
  if (code !== 0) {
    return { known: false, why: (stderr || stdout || `gh exited ${code}`).trim().split(`
`)[0] ?? "" };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { known: false, why: "the response was not JSON" };
  }
  const isPr = parsed.pull_request !== undefined;
  const kind = isPr ? "pull-request" : "issue";
  if (parsed.state === "open")
    return { known: true, kind, state: "open" };
  if (parsed.state === "closed") {
    return {
      known: true,
      kind,
      state: isPr ? pullRequestOutcome(Boolean(parsed.pull_request?.merged_at)) : issueOutcome(parsed.state_reason)
    };
  }
  return { known: false, why: `unrecognised state ${JSON.stringify(parsed.state ?? null)}` };
}

// src/domain/work/closed-issue.ts
function mayStartWorkOn(target) {
  return target.known && target.state === "open";
}
function canBeReopened(target) {
  return target.known && !(target.kind === "pull-request" && target.state === "done");
}
function recoveryAdvice(state, number, command) {
  if (state.known && !canBeReopened(state)) {
    return `#${number} is merged, and GitHub cannot reopen a merged pull request. ` + `Open an issue for the follow-up instead.`;
  }
  return `Reopen #${number} and comment \`${command}\` to run it.`;
}
function mentionPrefix(logins) {
  return logins.length > 0 ? `${logins.map((l) => `@${l}`).join(" ")} ` : "";
}
function dispatchRefusedNotice(refused) {
  const { agent, number, context, state, notify } = refused;
  const why = !state.known ? `the state of #${number} could not be read (${state.why})` : `#${number} is closed`;
  return [
    `${mentionPrefix(notify ? [notify] : [])}Atomaton: \`${agent}\` was not started on #${number}, because ${why}.`,
    "",
    `What was about to happen: ${context}.`,
    "",
    "Nothing will retry this.",
    "",
    !state.known ? `Start it by hand once #${number} can be read: comment \`/${agent}\` on it.` : recoveryAdvice(state, number, `/${agent}`)
  ].join(`
`);
}

// src/adapters/actions/dispatch.ts
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
var DEFAULT_LABELS = {
  sub_issue: "atomaton/sub-issue",
  launched: "atomaton/launched",
  in_progress: "atomaton/in-progress"
};
function getLabel(key) {
  return loadConfig().chain?.labels?.[key] ?? DEFAULT_LABELS[key];
}

// src/domain/work/issue-links.ts
var CLOSING_KEYWORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";
function claimsToClose(body, issue) {
  return new RegExp(`\\b(?:${CLOSING_KEYWORDS})\\s*:?\\s+#${issue}\\b`, "i").test(body);
}
function dedupeByNumber(...lists) {
  const seen = new Map;
  for (const list of lists)
    for (const item of list)
      if (!seen.has(item.number))
        seen.set(item.number, item);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

// src/adapters/github/issue-links.ts
var LINK_LIMIT = 50;
var LABEL_LIMIT = 20;
var QUERY = `
query($owner:String!, $name:String!, $number:Int!, $limit:Int!, $labelLimit:Int!) {
  repository(owner:$owner, name:$name) {
    issueOrPullRequest(number:$number) {
      __typename
      ... on Issue {
        parent { number title state stateReason }
        subIssues(first:$limit) { nodes { number title state stateReason labels(first:$labelLimit) { nodes { name } } } }
        closedByPullRequestsReferences(first:$limit, includeClosedPrs:true) {
          nodes { number title state merged body }
        }
        timelineItems(last:$limit, itemTypes:[CROSS_REFERENCED_EVENT]) {
          nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number title state merged body } } } }
        }
      }
      ... on PullRequest {
        closingIssuesReferences(first:$limit) { nodes { number title state stateReason } }
      }
    }
  }
}`;
function normalise(node) {
  return {
    number: node.number,
    title: node.title,
    state: saysOpen(node.state) ? "open" : issueOutcome(node.stateReason)
  };
}
function asChild(node) {
  return { ...normalise(node), labels: (node.labels?.nodes ?? []).map((label) => label.name) };
}
function asPr(node) {
  return {
    number: node.number,
    title: node.title,
    state: saysOpen(node.state) ? "open" : pullRequestOutcome(Boolean(node.merged))
  };
}
function issueLinks(repo, number) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    return { children: [], pullRequests: [], unavailable: `"${repo}" is not an owner/name repository` };
  }
  let issue = null;
  try {
    issue = ghGraphqlRead(QUERY, { owner, name, number, limit: LINK_LIMIT, labelLimit: LABEL_LIMIT }).repository?.issueOrPullRequest ?? null;
  } catch (error) {
    const why = error.message;
    console.error(`[atomaton-github] WARN could not read links for #${number}: ${why}`);
    return { children: [], pullRequests: [], unavailable: `GitHub could not be reached: ${why}` };
  }
  if (!issue)
    return { children: [], pullRequests: [], unavailable: `#${number} was not found` };
  if (issue.__typename === "PullRequest") {
    const closes = issue.closingIssuesReferences?.nodes ?? [];
    return {
      parent: closes[0] ? normalise(closes[0]) : undefined,
      children: [],
      pullRequests: []
    };
  }
  const declared = (issue.closedByPullRequestsReferences?.nodes ?? []).map(asPr);
  const referenced = (issue.timelineItems?.nodes ?? []).map((node) => node.source).filter((source) => Boolean(source?.number) && claimsToClose(source?.body ?? "", number)).map(asPr);
  return {
    parent: issue.parent ? normalise(issue.parent) : undefined,
    children: (issue.subIssues?.nodes ?? []).map(asChild),
    pullRequests: dedupeByNumber(declared, referenced)
  };
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

// src/adapters/github/work-tree.ts
function labelNames(labels) {
  return (labels ?? []).map((l) => typeof l === "string" ? l : l.name ?? "");
}
function parseListed(stdout) {
  try {
    return JSON.parse(stdout || "[]");
  } catch {
    return null;
  }
}
function readNode(repo, number) {
  const { code, stdout, stderr } = ghRead("api", `repos/${repo}/issues/${number}`);
  if (code !== 0) {
    return { problem: `could not read #${number}: ${(stderr || stdout).trim().split(`
`)[0] ?? ""}` };
  }
  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { problem: `the response for #${number} was not JSON` };
  }
  const isPr = raw.pull_request !== undefined;
  if (raw.state !== "open" && raw.state !== "closed") {
    return { problem: `#${number} reported an unrecognised state ${JSON.stringify(raw.state ?? null)}` };
  }
  const state = raw.state === "open" ? "open" : isPr ? pullRequestOutcome(Boolean(raw.pull_request?.merged_at)) : issueOutcome(raw.state_reason);
  return {
    node: {
      number,
      kind: isPr ? "pull-request" : "issue",
      state,
      parent: isPr ? PARENT_ISSUE_TAG.read(raw.body ?? "") : undefined,
      running: labelNames(raw.labels).includes(getLabel("in_progress"))
    }
  };
}
function readChildren(repo, parent) {
  const label = getLabel("in_progress");
  const nodes = [];
  const problems = [];
  const prs = ghRead("pr", "list", "--repo", repo, "--state", "all", "--limit", "200", "--search", `${PARENT_ISSUE_TAG.search(parent)} in:body`, "--json", "number,body,state,labels");
  if (prs.code !== 0)
    problems.push(`could not list the pull requests for #${parent}`);
  const listedPrs = parseListed(prs.stdout);
  if (listedPrs === null)
    problems.push(`the pull request listing for #${parent} was not readable`);
  for (const found of listedPrs ?? []) {
    if (PARENT_ISSUE_TAG.read(found.body ?? "") !== parent)
      continue;
    nodes.push({
      number: found.number,
      kind: "pull-request",
      state: saysOpen(found.state) ? "open" : pullRequestOutcome(found.state === "MERGED"),
      parent,
      running: labelNames(found.labels).includes(label)
    });
  }
  const links = issueLinks(repo, parent);
  if (links.unavailable) {
    problems.push(`could not read GitHub's own links for #${parent}: ${links.unavailable}`);
  }
  const already = new Set(nodes.map((node) => node.number));
  for (const child of links.children) {
    if (already.has(child.number))
      continue;
    already.add(child.number);
    nodes.push({
      number: child.number,
      kind: "issue",
      state: child.state,
      parent,
      running: child.labels.includes(label)
    });
  }
  for (const linked of links.pullRequests) {
    if (already.has(linked.number))
      continue;
    const { node, problem } = readNode(repo, linked.number);
    if (!node) {
      problems.push(problem ?? `could not read #${linked.number}`);
      continue;
    }
    already.add(linked.number);
    nodes.push({ ...node, parent });
  }
  return { nodes, problems };
}
function readWorkTree(repo, root) {
  const { node, problem } = readNode(repo, root);
  if (!node)
    return { nodes: [], problems: [problem ?? `could not read #${root}`] };
  const nodes = [node];
  const problems = [];
  const seen = new Set([root]);
  let frontier = [root];
  for (let depth = 0;depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      const found = readChildren(repo, parent);
      problems.push(...found.problems);
      for (const child of found.nodes) {
        if (seen.has(child.number))
          continue;
        seen.add(child.number);
        nodes.push(child);
        if (child.kind === "issue")
          next.push(child.number);
      }
    }
    frontier = next;
  }
  return { nodes, problems };
}
function lastEnding(repo, number) {
  const { code, stdout } = ghRead("api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", ".[].body");
  if (code !== 0)
    return;
  const bodies = stdout.split(`
`);
  for (let i = bodies.length - 1;i >= 0; i -= 1) {
    const ended = ENDED_TAG.read(bodies[i] ?? "");
    if (ended)
      return ended;
  }
  return;
}

// src/adapters/github/agent-on-issue.ts
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

// src/entrypoints/machinery/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/resolve_resume_agent.ts
var ref = defineScript(import.meta.url);
if (false)
  ;

// src/entrypoints/machinery/resume_subtree.ts
var ref2 = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { number: { type: "string" }, notify: { type: "string" } }
  });
  if (!values.number) {
    console.error("usage: resume_subtree.ts --number N [--notify LOGIN]");
    process.exit(2);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const root = Number(values.number);
  const { nodes, problems } = readWorkTree(repo, root);
  for (const problem of problems)
    console.error(`::warning::${problem}`);
  if (nodes.length === 0) {
    console.error(`Could not read the work under #${root}; nothing beyond it was resumed.`);
    return;
  }
  const candidates = resumeCandidates(descendants(subtree(nodes, root), root));
  const stoppedLast = new Set(candidates.filter((node) => lastEnding(repo, node.number) === "stopped").map((node) => node.number));
  const resumable = nodesToResume(candidates, stoppedLast);
  if (resumable.length === 0) {
    console.error(`Nothing under #${root} was waiting to be resumed.`);
    return;
  }
  const started = [];
  for (const node of resumable) {
    const agent = mostRecentAgentOn(repo, node.number);
    if (!agent) {
      console.error(`::warning::#${node.number} was stopped but nothing says which agent ran there; skipping.`);
      continue;
    }
    const outcome = dispatchRunner({
      context: `a resume on #${root} reached #${node.number}, which a stop had held`,
      agent,
      type: node.kind === "pull-request" ? "pr" : "issue",
      number: node.number,
      notify: (values.notify ?? "").trim(),
      repo
    });
    if (outcome === "dispatched")
      started.push(node.number);
    else
      console.error(`::warning::could not resume ${agent} on #${node.number} (${outcome}).`);
  }
  console.error(started.length > 0 ? `Resumed under #${root}: ${started.map((n) => `#${n}`).join(", ")}` : `Nothing under #${root} could be resumed.`);
}
if (import.meta.main)
  main();
export {
  ref2 as ref
};

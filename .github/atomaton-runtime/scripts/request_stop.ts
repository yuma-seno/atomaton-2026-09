#!/usr/bin/env bun
// @bun

// src/scripts/request_stop.ts
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

// src/domain/work-tree.ts
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
function nodesToStop(nodes) {
  return nodes.filter((node) => node.running);
}
function descendants(nodes, root) {
  return nodes.filter((node) => node.number !== root);
}
function stopReachedNotice(root) {
  return [
    `Atomaton: a stop on #${root} reached this work, so the run here has been asked to stop.`,
    "",
    "It stops after its current step, so it may take a minute, and it will report here when it has.",
    "",
    `To pick the work back up, comment \`/resume\` on #${root} \u2014 that restarts everything this stop held, rather than this piece alone.`
  ].join(`
`);
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

// src/lib/work-tree.ts
function labelNames(labels) {
  return (labels ?? []).map((l) => typeof l === "string" ? l : l.name ?? "");
}
function parseListed(stdout) {
  try {
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}
function readRoot(repo, number) {
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
  const merged = Boolean(raw.pull_request?.merged_at);
  const state = merged ? "merged" : raw.state === "open" ? "open" : "closed";
  if (raw.state !== "open" && raw.state !== "closed") {
    return { problem: `#${number} reported an unrecognised state ${JSON.stringify(raw.state ?? null)}` };
  }
  return {
    node: {
      number,
      kind: isPr ? "pull-request" : "issue",
      state,
      parent: PARENT_TAG.read(raw.body ?? "") ?? PARENT_ISSUE_TAG.read(raw.body ?? ""),
      running: labelNames(raw.labels).includes(getLabel("in_progress"))
    }
  };
}
function readChildren(repo, parent) {
  const label = getLabel("in_progress");
  const nodes = [];
  const problems = [];
  const issues = ghRead("issue", "list", "--repo", repo, "--state", "all", "--limit", "200", "--search", `${PARENT_TAG.write(parent)} in:body`, "--json", "number,body,state,labels");
  if (issues.code !== 0)
    problems.push(`could not list the sub-issues of #${parent}`);
  for (const found of parseListed(issues.stdout)) {
    if (PARENT_TAG.read(found.body ?? "") !== parent)
      continue;
    nodes.push({
      number: found.number,
      kind: "issue",
      state: found.state === "OPEN" ? "open" : "closed",
      parent,
      running: labelNames(found.labels).includes(label)
    });
  }
  const prs = ghRead("pr", "list", "--repo", repo, "--state", "all", "--limit", "200", "--search", `${PARENT_ISSUE_TAG.write(parent)} in:body`, "--json", "number,body,state,labels");
  if (prs.code !== 0)
    problems.push(`could not list the pull requests for #${parent}`);
  for (const found of parseListed(prs.stdout)) {
    if (PARENT_ISSUE_TAG.read(found.body ?? "") !== parent)
      continue;
    nodes.push({
      number: found.number,
      kind: "pull-request",
      state: found.state === "OPEN" ? "open" : found.state === "MERGED" ? "merged" : "closed",
      parent,
      running: labelNames(found.labels).includes(label)
    });
  }
  return { nodes, problems };
}
function readWorkTree(repo, root) {
  const { node, problem } = readRoot(repo, root);
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
function commentOn(repo, number, body) {
  return gh("issue", "comment", String(number), "--repo", repo, "--body", body).code === 0;
}
function requestStopAcross(repo, root, rootBody) {
  const { nodes, problems } = readWorkTree(repo, root);
  const all = subtree(nodes, root);
  const stopped = [];
  if (!commentOn(repo, root, rootBody)) {
    problems.push(`could not post the stop request on #${root}`);
  } else if (all.find((node) => node.number === root)?.running) {
    stopped.push(root);
  }
  for (const node of nodesToStop(descendants(all, root))) {
    const body = [LLM_CONTEXT_TAG.write("exclude"), STOP_TAG.write("requested"), stopReachedNotice(root)].join(`
`);
    if (commentOn(repo, node.number, body))
      stopped.push(node.number);
    else
      problems.push(`could not post the stop request on #${node.number}`);
  }
  return { stopped, problems };
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/request_stop.ts
var ref = defineScript(import.meta.url);
function stopRequestedNotice(commenter, deleted, alsoReached) {
  const whose = commenter ? `${commenter}'s` : "The";
  const lines = [
    LLM_CONTEXT_TAG.write("exclude"),
    STOP_TAG.write("requested"),
    "Atomaton: stop requested.",
    "",
    deleted ? `${whose} \`/stop\` comment was removed so it does not become part of the agent's context.` : `${whose} \`/stop\` comment could not be removed, so it may end up in the agent's context.`,
    "",
    "The run will stop after its current step, so it may take a minute, and it will report here when it has."
  ];
  if (alsoReached.length > 0) {
    lines.push("", `It also reached the work running on ${alsoReached.map((n) => `#${n}`).join(", ")}, ` + "which is under this issue. `/resume` here brings all of it back.");
  }
  return lines.join(`
`);
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      "comment-id": { type: "string" },
      commenter: { type: "string" }
    }
  });
  if (!values.number || !values["comment-id"]) {
    console.error("usage: request_stop.ts --number N --comment-id ID --commenter LOGIN");
    process.exit(2);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const number = String(values.number);
  const { code: delCode, stdout: delOut, stderr: delErr } = gh("api", "--method", "DELETE", `repos/${repo}/issues/comments/${values["comment-id"]}`);
  const deleted = delCode === 0;
  if (!deleted) {
    console.error(`Warning: failed to delete comment #${values["comment-id"]} on #${number}: ${delErr || delOut}`);
  }
  const root = Number(number);
  const { nodes } = readWorkTree(repo, root);
  const under = nodesToStop(descendants(subtree(nodes, root), root)).map((node) => node.number);
  const result = requestStopAcross(repo, root, stopRequestedNotice(values.commenter ?? "", deleted, under));
  const rootFailed = result.problems.some((problem) => problem.includes(`#${root}`));
  for (const problem of result.problems)
    console.error(`::warning::${problem}`);
  if (rootFailed)
    process.exit(1);
  console.error(`Stop requested across #${root}: ${result.stopped.length ? result.stopped.map((n) => `#${n}`).join(", ") : "no run was holding anything"}`);
}
if (import.meta.main)
  main();
export {
  ref,
  stopRequestedNotice
};

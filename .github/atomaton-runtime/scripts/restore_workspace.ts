#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/restore_workspace.ts
import { appendFileSync, mkdirSync as mkdirSync2 } from "fs";
import { parseArgs } from "util";

// src/entrypoints/machinery/lib/atomaton-data.ts
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";

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
function gitRun(...args) {
  return run(["git", ...args]);
}

// src/entrypoints/machinery/lib/atomaton-data.ts
function workspaceTargetPrefix(rootIssue) {
  return `workspace/issue-${rootIssue}`;
}
function restoreWorkspace(prefix, destDir) {
  if (gitRun("fetch", "origin", "atomaton-data", "--depth=1").code !== 0)
    return false;
  if (gitRun("cat-file", "-e", `origin/atomaton-data:${prefix}`).code !== 0)
    return false;
  mkdirSync(destDir, { recursive: true });
  const archive = Bun.spawnSync({
    cmd: ["git", "archive", "--format=tar", `origin/atomaton-data:${prefix}`],
    stdout: "pipe",
    stderr: "pipe"
  });
  if (archive.exitCode !== 0) {
    console.error(`[atomaton-data] git archive failed: ${archive.stderr.toString().trim()}`);
    return false;
  }
  const extract = Bun.spawnSync({
    cmd: ["tar", "-x", "-C", destDir],
    stdin: archive.stdout,
    stdout: "pipe",
    stderr: "pipe"
  });
  if (extract.exitCode !== 0) {
    console.error(`[atomaton-data] tar failed: ${extract.stderr.toString().trim()}`);
    return false;
  }
  return true;
}

// src/adapters/github/parent-issue.ts
function log(message) {
  console.error(`[atomaton-parent] ${message}`);
}
function parentIssueOf(repo, issue) {
  const [owner, name] = repo.split("/", 2);
  if (!owner || !name) {
    const why = `'${repo}' is not an owner/name repository, so #${issue}'s parent could not be asked for`;
    log(`WARN ${why}`);
    return { known: false, why };
  }
  try {
    const data = ghGraphqlRead("query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){parent{number}}}}", { owner, repo: name, num: issue });
    return { known: true, parent: data.repository.issue.parent?.number ?? 0 };
  } catch (error) {
    const why = `could not read the parent of #${issue}: ${error.message}`;
    log(`WARN ${why}`);
    return { known: false, why };
  }
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

// src/domain/work/workspace.ts
var WORKSPACE_PATH = "/tmp/atomaton-workspace";
var WORKSPACE_SENTENCE = `Anything under ${WORKSPACE_PATH} survives into the next run on this issue and is shared with the other ` + `agents working on it. Nothing else outside the repository survives. Put notes, scratch scripts and ` + `intermediate output there rather than in the repository, where they would be committed as part of the work.`;
function workspaceScope(target, parents, why = "") {
  const root = parents.length > 0 ? parents[parents.length - 1] : undefined;
  if (root === undefined) {
    return { rootIssue: String(target), resolved: why === "", why };
  }
  return { rootIssue: String(root), resolved: true, why: "" };
}

// src/adapters/github/workspace-scope.ts
var MAX_HOPS = 6;
function log2(message) {
  console.error(`[atomaton-workspace] ${message}`);
}
function issueOfPullRequest(repo, number) {
  const { code, stdout } = gh("pr", "view", String(number), "--repo", repo, "--json", "body", "--jq", ".body");
  if (code) {
    log2(`WARN could not read pull request #${number}`);
    return;
  }
  return PARENT_ISSUE_TAG.read(stdout);
}
function resolveWorkspaceScope(repo, type, number) {
  const target = Number(number);
  if (!Number.isFinite(target) || target <= 0) {
    return workspaceScope(number, [], `"${number}" is not an issue or pull request number`);
  }
  const chain = [];
  let current = target;
  if (type === "pr") {
    const issue = issueOfPullRequest(repo, target);
    if (issue === undefined) {
      log2(`#${target} names no parent issue; its workspace is its own`);
      return workspaceScope(number, []);
    }
    chain.push(issue);
    current = issue;
  }
  const visited = new Set([target]);
  for (let hop = 0;hop < MAX_HOPS; hop++) {
    if (visited.has(current) && hop > 0) {
      log2(`WARN parent chain revisits #${current}; stopping the walk here`);
      break;
    }
    visited.add(current);
    const parentage = parentIssueOf(repo, current);
    if (!parentage.known) {
      return workspaceScope(number, chain, chain.length > 0 ? "" : parentage.why);
    }
    if (parentage.parent === 0)
      break;
    chain.push(parentage.parent);
    current = parentage.parent;
  }
  const scope = workspaceScope(number, chain);
  if (!scope.resolved)
    log2(`WARN ${scope.why}; using this target's own workspace`);
  else if (scope.rootIssue !== String(number))
    log2(`sharing issue #${scope.rootIssue}'s workspace`);
  return scope;
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
var TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;
var TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;
var RULESETS_DIR = `${USER_ROOT}/rulesets`;
var SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;

// src/entrypoints/machinery/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/restore_workspace.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      type: { type: "string" },
      number: { type: "string" },
      dest: { type: "string" },
      repo: { type: "string" }
    }
  });
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!values.type || !values.number || !values.dest || !repo) {
    console.error("usage: restore_workspace.ts --type issue|pr --number N --dest PATH [--repo owner/name]");
    process.exit(2);
  }
  const scope = resolveWorkspaceScope(repo, values.type, values.number);
  const prefix = workspaceTargetPrefix(scope.rootIssue);
  mkdirSync2(values.dest, { recursive: true });
  const restored = restoreWorkspace(prefix, values.dest);
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `root_issue=${scope.rootIssue}
restored=${restored}
`);
  }
  console.error(restored ? `[atomaton-workspace] restored ${prefix} into ${values.dest}` : `[atomaton-workspace] nothing stored at ${prefix} yet; ${values.dest} starts empty`);
}
if (import.meta.main)
  main();
export {
  ref
};

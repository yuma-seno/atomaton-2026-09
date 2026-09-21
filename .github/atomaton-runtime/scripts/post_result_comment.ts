#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/post_result_comment.ts
import { appendFileSync, existsSync, readFileSync } from "fs";
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

// src/domain/work/completion-mention.ts
function shouldMentionOnCompletion(signals) {
  if (!signals.notify)
    return false;
  if (signals.ending.ended === "no-report")
    return true;
  if (signals.ending.next)
    return false;
  if (signals.chainContinues)
    return false;
  if (signals.isSubIssue && signals.issueClosed)
    return false;
  return true;
}

// src/domain/work/turn.ts
function endingOf(signals) {
  const named = signals.directive.trim();
  const next = named === "" ? undefined : { agent: named };
  if (!signals.succeeded || signals.endedBecause === "failed")
    return { ended: "failed" };
  if (signals.endedBecause === "stopped")
    return { ended: "stopped" };
  if (signals.endedBecause === "iterations" || signals.endedBecause === "runtime")
    return { ended: "spent" };
  if (signals.loopLimitReached)
    return { ended: "chain-over", ...next ? { next } : {} };
  if (next || signals.chainContinues)
    return { ended: "handed-off", ...next ? { next } : {} };
  if (!signals.reported)
    return { ended: "no-report" };
  return { ended: "finished" };
}

// src/shared/redaction.ts
var PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
];
var REDACTED = "[redacted]";
function redact(text, literals = []) {
  let out = text;
  for (const literal of literals)
    out = out.split(literal).join(REDACTED);
  for (const pattern of PATTERNS)
    out = out.replace(pattern, REDACTED);
  return out;
}

// src/domain/record/token-line.ts
function renderTokenLine(u) {
  const split = `${u.prompt ?? "?"} prompt + ${u.completion ?? "?"} completion`;
  const share = u.cached === undefined ? "" : `, ${u.cached} of the prompt cached`;
  return `_Tokens: ${u.total ?? "?"} total (${split}${share})_`;
}

// src/domain/record/tool-trouble.ts
var NAMED = 3;
function looksRefused(content) {
  return /blocked by hook|shell_guard:|Tool blocked/.test(content) || /is blocked by denylist pattern/.test(content) || /is not permitted by the allowlist/.test(content) || /Refusing to close issue #[0-9]+: opened by a human/.test(content);
}
function looksFailed(content) {
  if (looksRefused(content))
    return false;
  return /^\s*(Error|error):/.test(content) || /"status"\s*:\s*"(failed|error)"/.test(content);
}
function problemsIn(content) {
  const marker = /^--- \d+ problems? reported by the '([^']+)' server/m.exec(content);
  if (!marker)
    return [];
  const server = marker[1];
  const out = [];
  for (const line of content.slice(marker.index).split(`
`)) {
    const reported = /^(error|warning):\s*(.+)$/.exec(line.trim());
    if (reported)
      out.push({ server, problem: normaliseProblem(reported[2]) });
  }
  return out;
}
function normaliseProblem(text) {
  return text.replace(/\s+/g, " ").replace(/#[0-9]+/g, "#N").replace(/[0-9]{3,}/g, "N").trim().slice(0, 120);
}
function toolTroubleLine(session, from) {
  if (from === undefined || !Number.isFinite(from))
    return;
  const messages = session?.messages ?? [];
  const servers = new Map;
  let problems = 0;
  let stopped = 0;
  for (let i = Math.max(0, from);i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "tool")
      continue;
    const content = typeof message.content === "string" ? message.content : "";
    for (const { server } of problemsIn(content)) {
      problems += 1;
      servers.set(server, (servers.get(server) ?? 0) + 1);
    }
    if (looksRefused(content) || looksFailed(content))
      stopped += 1;
  }
  if (problems === 0 && stopped === 0)
    return;
  const parts = [];
  if (problems > 0) {
    const ranked = [...servers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = ranked.slice(0, NAMED).map(([server]) => `\`${server}\``);
    const rest = ranked.length - shown.length;
    if (rest > 0)
      shown.push(`and ${rest} other server${rest === 1 ? "" : "s"}`);
    const said = servers.size === 1 ? "a server reported about itself" : "servers reported about themselves";
    parts.push(`${problems} problem${problems === 1 ? "" : "s"} ${said} (${shown.join(", ")})`);
  }
  if (stopped > 0)
    parts.push(`${stopped} refused or errored tool call${stopped === 1 ? "" : "s"}`);
  return `Counted from the session: ${parts.join(", ")}.`;
}

// src/domain/work/mention.ts
var MENTION = /(^|[^\w@/-])@([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\b(?!\/)/g;
var CODE = /```[\s\S]*?```|`[^`\n]*`/g;
function escapeUnknownMentions(text, known) {
  const allowed = new Set([...known].map((login) => login.trim().toLowerCase()).filter(Boolean));
  const escaped = [];
  const transform = (segment) => segment.replace(MENTION, (whole, before, login) => {
    if (allowed.has(login.toLowerCase()))
      return whole;
    if (!escaped.includes(login))
      escaped.push(login);
    return `${before}\`@${login}\``;
  });
  let out = "";
  let last = 0;
  CODE.lastIndex = 0;
  for (const match of text.matchAll(CODE)) {
    const at = match.index ?? 0;
    out += transform(text.slice(last, at));
    out += match[0];
    last = at + match[0].length;
  }
  out += transform(text.slice(last));
  return { text: out, escaped };
}
function escapedMentionNotice(escaped) {
  if (escaped.length === 0)
    return;
  const names = escaped.map((login) => `\`@${login}\``).join(", ");
  return `> [!NOTE]
` + `> ${names} ${escaped.length === 1 ? "was" : "were"} written as ${escaped.length === 1 ? "a mention" : "mentions"} ` + `and had the notification removed: this run could not confirm ${escaped.length === 1 ? "that account" : "those accounts"} ` + `as a participant in this repository or this thread. Nobody was notified. If the mention was meant, mention them yourself.`;
}

// src/adapters/github/participants.ts
function knownParticipants(repo, number) {
  if (!repo || !String(number).trim())
    return [];
  const logins = new Set;
  const collect = (args, read) => {
    const { code, stdout } = gh(...args);
    if (code !== 0)
      return;
    try {
      for (const login of read(JSON.parse(stdout))) {
        if (typeof login === "string" && login)
          logins.add(login);
      }
    } catch {}
  };
  collect(["api", `repos/${repo}/issues/${number}`], (json) => [
    json.user?.login
  ]);
  collect(["api", `repos/${repo}/issues/${number}/comments`, "--paginate"], (json) => json.map((comment) => comment.user?.login));
  collect(["api", `repos/${repo}/collaborators`, "--paginate"], (json) => json.map((person) => person.login));
  return [...logins];
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

// src/entrypoints/machinery/post_result_comment.ts
var ref = defineScript(import.meta.url);
function tokenUsageLines(logsFile) {
  if (!existsSync(logsFile))
    return [];
  const usageLine = readFileSync(logsFile, "utf8").split(`
`).find((l) => l.includes("ATOMA_TOKEN_USAGE:"));
  if (!usageLine)
    return [];
  const prompt = /prompt=(\d+)/.exec(usageLine)?.[1];
  const completion = /completion=(\d+)/.exec(usageLine)?.[1];
  const total = /total=(\d+)/.exec(usageLine)?.[1];
  const cached = /cached=(\d+)/.exec(usageLine)?.[1];
  return ["", "---", renderTokenLine({ total, prompt, completion, cached })];
}
function subIssueState(number, type) {
  if (type !== "issue")
    return { isSubIssue: false, issueClosed: false };
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const { code, stdout } = gh("issue", "view", number, "--repo", repo, "--json", "state");
  if (code !== 0)
    return { isSubIssue: false, issueClosed: false };
  let issueClosed = false;
  try {
    issueClosed = JSON.parse(stdout).state === "CLOSED";
  } catch {
    return { isSubIssue: false, issueClosed: false };
  }
  const found = parentIssueOf(repo, Number(number));
  return { isSubIssue: found.known && found.parent > 0, issueClosed };
}
function readSession(path) {
  if (!path || !existsSync(path))
    return;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}
function lastAgentText(sessionPath, from) {
  if (from === undefined || !Number.isFinite(from))
    return;
  const messages = readSession(sessionPath)?.messages ?? [];
  for (let i = messages.length - 1;i >= from; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant")
      continue;
    const content = message.content;
    if (typeof content === "string" && content.trim() !== "")
      return content;
  }
  return;
}
function endedTag(ending) {
  switch (ending.ended) {
    case "stopped":
      return "stopped";
    case "spent":
      return "limit";
    case "failed":
    case "chain-over":
    case "handed-off":
    case "no-report":
    case "finished":
      return "done";
  }
}
function cutShort(endedBecause) {
  return endedBecause === "stopped" || endedBecause === "runtime" || endedBecause === "iterations";
}
function howItWasCutShort(endedBecause) {
  if (endedBecause === "stopped")
    return "was stopped";
  return endedBecause === "iterations" ? "ran out of iterations" : "ran out of time";
}
function mentionLine(ending, args) {
  if (cutShort(args.endedBecause)) {
    return `@${args.notify} \u2014 **${args.agent}** ${howItWasCutShort(args.endedBecause)} ` + `before it finished, and no agent will run next. Resume it, or say what to do instead.`;
  }
  if (ending.ended === "no-report") {
    return `@${args.notify} \u2014 **${args.agent}** ended without writing a report. Nothing interrupted it ` + `and nothing runs next; it simply left no closing text, so there is nothing here to review. ` + `What it did is in its saved session.`;
  }
  return `@${args.notify} \u2014 **${args.agent}** task completed. No agent will be automatically executed next. Please review the results or provide instructions for the next step.`;
}
function endingHere(args) {
  return endingOf({
    succeeded: true,
    endedBecause: args.endedBecause ?? "",
    loopLimitReached: false,
    chainContinues: args.chainContinues === "true",
    directive: args.directive ?? "",
    reported: args.reported === true
  });
}
function buildCommentBody(args) {
  const ending = endingHere(args);
  const lines = [
    AGENT_TAG.write(args.agent),
    CHANGED_TAG.write(args.changed === true ? "yes" : "no"),
    ENDED_TAG.write(endedTag(ending))
  ];
  if (args.salvaged === true) {
    lines.push("> [!WARNING]", "> This run ended before it wrote a report. Below is the last thing it said,", "> from the middle of the work \u2014 not a conclusion, and not a summary of what it found.", "");
  } else if (args.wroteNothing === true) {
    lines.push("> [!WARNING]", "> This run ended before it said anything at all, so there is no report below \u2014", "> not even a partial one. What it had done is in its saved session.", "");
  }
  lines.push(args.output, "", ...args.usageLines);
  const escapedNotice = escapedMentionNotice(args.escapedMentions ?? []);
  if (escapedNotice !== undefined)
    lines.push("", escapedNotice, "");
  if (shouldMentionOnCompletion({
    ending,
    chainContinues: args.chainContinues === "true",
    notify: args.notify,
    isSubIssue: args.isSubIssue ?? false,
    issueClosed: args.issueClosed ?? false
  })) {
    lines.push(mentionLine(ending, args), "");
  }
  const metrics = args.repo ? ` \xB7 [metrics](https://github.com/${args.repo}/blob/atomaton-data/metrics/report.md)` : "";
  lines.push("---", `_run by [${args.agent}](${args.runUrl})${metrics}_`);
  if (args.toolTrouble !== undefined)
    lines.push(`_${args.toolTrouble}_`);
  if (args.endedBecause === "stopped") {
    lines.push(`\u23F8\uFE0F _Stopped on request. **The session is saved.** Comment \`/resume\` to continue ` + `from here, or \`/${args.agent}\` with an instruction on the following lines._`);
  } else if (cutShort(args.endedBecause)) {
    lines.push(`\u26A0\uFE0F _The run ${howItWasCutShort(args.endedBecause)}. Comment \`/${args.agent}\` to continue._`);
  }
  return lines.join(`
`);
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      agent: { type: "string" },
      type: { type: "string" },
      notify: { type: "string" },
      directive: { type: "string" },
      "chain-continues": { type: "string" },
      "ended-because": { type: "string" },
      reported: { type: "string" },
      "messages-before": { type: "string" },
      "run-url": { type: "string" },
      changed: { type: "string" },
      session: { type: "string" },
      output: { type: "string" },
      "logs-file": { type: "string" }
    }
  });
  if (!values.number || !values.agent || !values["run-url"]) {
    console.error("usage: post_result_comment.ts --number N --agent NAME --run-url URL [...]");
    process.exit(2);
  }
  const outputFile = values.output;
  if (!outputFile) {
    console.error("post_result_comment.ts: --output is required (the agent's stdout file)");
    process.exit(2);
  }
  const redacted = redact(existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "");
  const endedEarly = cutShort(values["ended-because"]);
  let output = redacted;
  let salvaged = false;
  let wroteNothing = false;
  if (!output.trim() && endedEarly) {
    const last = lastAgentText(values.session, Number(values["messages-before"]));
    if (last !== undefined) {
      output = redact(last);
      salvaged = true;
      console.error("salvaged the agent's last message from the session (cut short)");
    }
  }
  if (!output.trim()) {
    if (!endedEarly) {
      console.error("atomaton_output.txt is empty (session ended via a tool call) -- skipping result comment.");
      return;
    }
    wroteNothing = true;
    output = values["ended-because"] === "stopped" ? "_This run was stopped before it said anything._" : `_This run ${howItWasCutShort(values["ended-because"])} before it said anything._`;
    console.error("the run was cut short with nothing to report -- posting the notice rather than nothing.");
  }
  const checked = escapeUnknownMentions(output, knownParticipants(process.env.GITHUB_REPOSITORY ?? "", values.number));
  if (checked.escaped.length > 0) {
    console.error(`escaped ${checked.escaped.length} unconfirmed mention(s): ${checked.escaped.join(", ")}`);
  }
  const body = buildCommentBody({
    agent: values.agent,
    salvaged,
    wroteNothing,
    notify: values.notify,
    directive: values.directive,
    chainContinues: values["chain-continues"],
    endedBecause: values["ended-because"],
    reported: values.reported === "true",
    runUrl: values["run-url"],
    repo: process.env.GITHUB_REPOSITORY ?? "",
    output: checked.text,
    escapedMentions: checked.escaped,
    changed: values.changed === "true",
    toolTrouble: toolTroubleLine(readSession(values.session), Number(values["messages-before"])),
    usageLines: tokenUsageLines(values["logs-file"] ?? ""),
    ...subIssueState(values.number, values.type)
  });
  const { code, stdout, stderr } = gh("api", `repos/${process.env.GITHUB_REPOSITORY}/issues/${values.number}/comments`, "--method", "POST", "-f", `body=${body}`, "--jq", ".id");
  if (code !== 0) {
    throw new Error(`Failed to post result comment: ${stderr || stdout}`);
  }
  const commentId = stdout.trim();
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput)
    appendFileSync(githubOutput, `comment_id=${commentId}
`);
  console.error(`Posted comment ID: ${commentId}`);
}
if (import.meta.main)
  main();
export {
  buildCommentBody,
  lastAgentText,
  ref
};

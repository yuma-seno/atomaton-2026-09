#!/usr/bin/env bun
/**
 * github.ts — Unified GitHub MCP server for Atomaton.
 *
 * Transport: stdio, via the official @modelcontextprotocol/sdk.
 * Dependencies: `gh` CLI + `git`.
 *
 * Every mutation is logged to $ATOMATON_OPS_LOG (see lib/ops-log.ts) as a
 * general audit trail; dispatch decisions specifically are also what
 * atomaton-runner.wac.ts's chain_continues detection reads.
 *
 * IMPORTANT: this process's `process.stdout` IS the JSON-RPC transport --
 * never `console.log()` anywhere in this file or in anything it calls
 * in-process (resolveNotify/dispatchOrchestratorIfSubIssueReady/etc.);
 * always `console.error()` (`log()` below) for logging.
 */
import { gh, ghGraphql, gitRun, nothingToCommit } from "../../../adapters/github/gh.ts";
import { getBaseBranch, getLabel } from "../../../adapters/runner/config.ts";
import { resolveNotify } from "../../../adapters/github/notify.ts";
import {
  describeGateResult,
  dispatchOrchestratorIfSubIssueReady,
  needsAttention,
  type DispatchGateResult,
} from "../../../app/aggregation.ts";
import { logOp } from "../../../adapters/runner/ops-log.ts";
import { report } from "../../../adapters/mcp/mcp-report.ts";
import { knownParticipants } from "../../../adapters/github/participants.ts";
import { escapedMentionNotice, escapeUnknownMentions } from "../../../domain/work/mention.ts";
import { LLM_CONTEXT_TAG, NOTIFY_TAG, ORIGIN_AGENT_TAG, PARENT_ISSUE_TAG } from "../../../adapters/github/tags.ts";
import { closingKeywordRefusal, closingReferences } from "../../../domain/work/issue-links.ts";
import { closeRequestComment } from "../../../domain/work/close-request.ts";
import type { GhIssueAuthor } from "../../../adapters/github/wire-types.ts";
import { buildMcpTools, defineMcpTool, positiveInt, serveMcpServer, stringArray, withoutBookkeeping, z, type McpToolResult } from "../../../adapters/mcp/mcp-tool.ts";
import { capText, fitItems, TOOL_OUTPUT_BUDGET } from "../../../shared/tool-output.ts";
import { decidePostMergeHandoff } from "../../../domain/work/handoff.ts";
import { isAttended, unattendedNotice } from "../../../domain/work/unattended-pull-request.ts";
import { branchForCommit, resolveBranch, stackedPrBase } from "../../../adapters/github/branch-placement.ts";
import { dispatchCd, dispatchCi, dispatchPostMergeAgent, dispatchPrValidation } from "../../../adapters/actions/dispatch-targets.ts";
import { issueLinks } from "../../../adapters/github/issue-links.ts";
import type { LinkedChild, LinkedIssue } from "../../../domain/work/issue-links.ts";
import { decideMergeReadiness, formatBlockers } from "../../../domain/delivery/merge-readiness.ts";
import { gatherMergeSignals } from "../../../adapters/github/merge-signals.ts";
import { selectCommentRange } from "../../../domain/work/comment-range.ts";
import { hardenCredentialHolder } from "../lib/harden.ts";

function log(msg: string): void {
  console.error(`[atomaton-github] ${msg}`);
}

// Same OS user as every other tool server, including the one that runs arbitrary
// commands -- so this process makes itself unreadable to its peers and drops
// writable directories from its PATH. See `../lib/harden.ts` for what that closes,
// what it costs, and what it deliberately leaves open.
hardenCredentialHolder(log);

let REPO = process.env.GITHUB_REPOSITORY ?? "";
// Fallback: derive REPO from git remote if env var is not set.
if (!REPO) {
  try {
    const { code, stdout } = gitRun("remote", "get-url", "origin");
    if (code === 0 && stdout) {
      const url = stdout.trim();
      for (const prefix of ["https://github.com/", "git@github.com:"]) {
        if (url.startsWith(prefix)) {
          const suffix = url.slice(prefix.length);
          REPO = suffix.endsWith(".git") ? suffix.slice(0, -4) : suffix;
          break;
        }
      }
    }
  } catch {
    // best-effort
  }
}

function mcpFail(message: string): never {
  throw new Error(message);
}

function ghJsonOrThrow<T>(...args: string[]): T {
  const { code, stdout, stderr } = gh(...args);
  if (code) mcpFail(stderr || stdout);
  return stdout ? (JSON.parse(stdout) as T) : (null as T);
}

async function resolveIssueId(number: number): Promise<string> {
  const [owner, repo] = REPO.split("/", 2);
  const d = ghGraphql<{ repository: { issue: { id: string } } }>(
    "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){id}}}",
    { owner: owner!, repo: repo!, num: number },
  );
  return d.repository.issue.id;
}

/**
 * What each shape of tool calls its number.
 *
 * These were both `number`, with `adapters/mcp/mcp-tool.ts` folding four synonyms into it —
 * `issue_number`, `pr_number`, `pull_number`, `pull_request_number` — before the
 * schema was allowed to see the call. Only ONE of those was ever observed
 * (`issue_number`, three times in one run); the other three were speculative, which
 * that file's own comment forbids: "a speculative synonym is indistinguishable from a
 * typo, and quietly accepting a typo is the defect strictness exists to prevent".
 *
 * So the name is the one a model reaches for, and there are no synonyms. Every tool
 * here addresses exactly one kind of object — the schemas were already split
 * issue-shaped and PR-shaped, and each tool's name (`get_issue`, `merge_pr`) fixes
 * which — so there is nothing ambiguous about spelling it out. The same repair as
 * atoma#24's `load_skill`, which had grown five spellings of one argument.
 *
 * Constants because each name is written twice: once in the schema below and once in
 * the refusal a caller reads when they leave it out. That is exactly the pair that
 * drifted in atoma#24.
 */
const ISSUE_NUMBER_ARG = "issue_number";
const PR_NUMBER_ARG = "pull_number";

/**
 * Schema for a MUTATION on an issue, whose number is never inferred.
 *
 * Required, and deliberately not defaulted from the run: inferring the target of an
 * irreversible, outward-facing action turns a malformed call into a wrong close
 * instead of an error message.
 */
const ISSUE_NUMBER_ARG_SCHEMA = z.object({
  [ISSUE_NUMBER_ARG]: positiveInt("Positive GitHub issue number, without a leading '#'."),
});

/** Schema for a MUTATION on a pull request. Required, for the same reason. */
const PR_NUMBER_ARG_SCHEMA = z.object({
  [PR_NUMBER_ARG]: positiveInt("Positive GitHub pull request number, without a leading '#'."),
});

/**
 * Schema for read-only ISSUE lookups whose `number` defaults to the issue this
 * run is already operating on.
 *
 * Deliberately not used for mutations. Inferring the target of an irreversible,
 * outward-facing action from an environment variable turns a malformed call into
 * a wrong merge instead of an error message, so `close_issue` and `merge_pr`
 * require the number.
 *
 * It was also not meant for PR reads, and `check_merge_readiness` used it
 * anyway. The comment here explained precisely the failure that caused: a
 * defaulted PR read during an issue run shells out `gh pr view <issue-number>`
 * and returns "Could not resolve to a PullRequest" — an iteration burnt on the
 * one tool whose job is explaining refusals. `PR_CONTEXT_NUMBER_ARG_SCHEMA`
 * below is the PR-shaped version, and it defaults only when the run really is a
 * pull request run.
 */
const ISSUE_CONTEXT_NUMBER_ARG_SCHEMA = z.object({
  [ISSUE_NUMBER_ARG]: positiveInt(
    "Positive GitHub issue number, without a leading '#'. " +
      "Omit to use the issue this run is already operating on.",
  ).optional(),
});

/**
 * Schema for a read-only PULL REQUEST lookup that may default to this run's own.
 *
 * The old comment above claimed "the run env does not say whether that was an
 * issue or a PR". It does: `ATOMATON_RUN_TYPE` is set by the runner and is exactly
 * `"issue"` or `"pr"`, and `branch-placement.ts` — imported by this file —
 * already guards on it. So the default is available to a PR read, provided it
 * checks first.
 */
const PR_CONTEXT_NUMBER_ARG_SCHEMA = z.object({
  [PR_NUMBER_ARG]: positiveInt(
    "Positive pull request number, without a leading '#'. " +
      "Omit only on a pull request run, to use the pull request this run is reviewing; " +
      "on an issue run, pass the number of the pull request that closes it.",
  ).optional(),
});


const ISSUE_COMMENTS_SCHEMA = z.object({
  [ISSUE_NUMBER_ARG]: positiveInt(
    "Positive GitHub issue number, without a leading '#'. Omit to use the issue this run is already operating on.",
  ).optional(),
  from: positiveInt(
    "First comment to return, counting from 1 in the order they were posted. " +
      "This is the number `search__search_issues` reports as `comment`, so a match can be read directly.",
  ).optional(),
  to: positiveInt("Last comment to return, inclusive. Defaults to `from`, so passing only `from` reads one comment.").optional(),
});

/**
 * Resolve an issue read's target, falling back to the run's issue number.
 *
 * Models omit it entirely when they are already reasoning about a single issue,
 * which used to surface as a required-argument error and burn an iteration.
 * `ISSUE_NUMBER` is the number the runner resolved for this run (see
 * `atomaton-runner.wac.ts`), and is already relied on elsewhere in this file.
 */
function issueContextNumber(args: { issue_number?: number }): number {
  if (args[ISSUE_NUMBER_ARG] !== undefined) return args[ISSUE_NUMBER_ARG];
  const raw = (process.env.ISSUE_NUMBER ?? "").trim();
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
    mcpFail(
      `\`${ISSUE_NUMBER_ARG}\` was omitted and this run has no current issue number. ` +
        `Pass \`${ISSUE_NUMBER_ARG}\` explicitly.`,
    );
  }
  return parsed;
}

/**
 * The message a mutation gives when its number was left out.
 *
 * Reads above may default their target from the run; mutations may not, and the
 * comment on `ISSUE_CONTEXT_NUMBER_ARG_SCHEMA` says why: inferring the target of an
 * irreversible outward-facing action turns a malformed call into a wrong merge.
 * That rule stays. What changes is the refusal it produces.
 *
 * Measured on the tool this was written for, since removed: 28 calls with
 * `{event, body}` and no number, each answered "number: Expected number, received
 * undefined" -- true, and no help at all to a caller looking at exactly one pull
 * request. Naming the number costs nothing and keeps the decision with the agent:
 * it still has to pass it.
 */
function omittedNumberGuidance(what: "pull request" | "issue"): (args: Record<string, unknown>) => string | undefined {
  const arg = what === "pull request" ? PR_NUMBER_ARG : ISSUE_NUMBER_ARG;
  return (args) => {
    if (arg in args) return undefined;
    if (process.env.ATOMATON_RUN_TYPE !== (what === "pull request" ? "pr" : "issue")) return undefined;
    const raw = (process.env.ISSUE_NUMBER ?? "").trim();
    if (!/^[0-9]+$/.test(raw)) return undefined;
    return (
      `\`${arg}\` is required and was omitted. This tool changes GitHub, so unlike the ` +
      "read-only tools it will not infer its target -- a guessed number here is a wrong " +
      `merge or a wrong close, not an error message. This run is working on ${what} ` +
      `#${raw}; if that is the one you mean, call this again with {"${arg}": ${raw}}.`
    );
  };
}

/**
 * Resolve a pull request read's target, falling back to this run's number only
 * when the run is a pull request run.
 *
 * The type check is the whole point. Issues and pull requests share one number
 * space, so `ISSUE_NUMBER` on an issue run is a perfectly valid-looking pull
 * request number that belongs to a different thing entirely — and the resulting
 * `gh pr view <issue-number>` fails with a GitHub error about resolving a
 * PullRequest, which reads as a broken tool rather than a missing argument.
 */
function prContextNumber(args: { pull_number?: number }): number {
  if (args[PR_NUMBER_ARG] !== undefined) return args[PR_NUMBER_ARG];
  if (process.env.ATOMATON_RUN_TYPE !== "pr") {
    mcpFail(
      `\`${PR_NUMBER_ARG}\` was omitted, and this run is working on an issue rather than a ` +
        "pull request. Pass the pull request's number explicitly — an issue's number is not a " +
        "pull request's.",
    );
  }
  const raw = (process.env.ISSUE_NUMBER ?? "").trim();
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
    mcpFail(
      `\`${PR_NUMBER_ARG}\` was omitted and this run has no current pull request number. ` +
        `Pass \`${PR_NUMBER_ARG}\` explicitly.`,
    );
  }
  return parsed;
}

const CREATE_ISSUE_SCHEMA = z.object({
  title: z.string().min(1).describe("Concise issue title."),
  body: z.string().optional().describe("Issue body in GitHub-flavored Markdown. Defaults to an empty body."),
  labels: stringArray("Existing repository label names to apply. Defaults to no extra labels.").optional(),
  sub_issue: z
    .boolean()
    .optional()
    .describe("Set sub_issue=true to automatically link it to the current issue as a child task. Defaults to true."),
});

const LIST_ISSUES_SCHEMA = z.object({
  state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter. Defaults to 'open'."),
  labels: stringArray("Return only issues matching these repository labels.").optional(),
  limit: positiveInt("Maximum issues to return. Defaults to 30; maximum 100.").max(100).optional(),
});

const CREATE_PR_SCHEMA = z.object({
  title: z.string().min(1).describe("Concise pull request title."),
  body: z.string().optional().describe("Pull request body in GitHub-flavored Markdown. Atomaton adds issue traceability metadata automatically."),
  base: z.string().optional().describe("Target branch name. Omit and this is resolved in three steps: the parent's branch when this run is a sub-issue whose parent branch exists, so sibling work stacks and integrates once; otherwise the repository's configured base branch; otherwise its default branch. The resolved value is returned as `base`, and it decides whether merging this deploys."),
  reviewer: z
    .string()
    .optional()
    .describe(
      "Which agent should review this once CI passes, for example 'reviewer'. Nothing reviews a pull request " +
        "unless you ask: opening one no longer starts anyone by itself. Omit it only when a review is genuinely " +
        "not wanted -- a person is then told the pull request is waiting, by name, so it does not sit unnoticed.",
    ),
});

const LIST_PRS_SCHEMA = z.object({
  state: z.enum(["open", "closed", "merged", "all"]).optional().describe("Pull request state filter. Defaults to 'open'."),
  limit: positiveInt("Maximum pull requests to return. Defaults to 30; maximum 100.").max(100).optional(),
});

const SEARCH_CODE_SCHEMA = z.object({
  query: z.string().min(1).describe("GitHub code-search query scoped automatically to the current repository."),
});
const GET_BRANCH_SCHEMA = z.object({
  // `branch`, not `name`, so this and `sync_branch` call one thing by one name.
  branch: z.string().min(1).describe("Repository branch name, for example 'main' or 'atomaton/issue-42'."),
});
const GET_CHECK_RUNS_SCHEMA = z.object({
  ref: z.string().min(1).describe("Commit SHA, branch name, or tag whose GitHub check runs should be returned."),
});
const SYNC_BRANCH_SCHEMA = z.object({
  branch: z.string().optional().describe("Branch to synchronize. Defaults to the current Atomaton branch."),
});

const COMMIT_AND_PUSH_SCHEMA = z.object({
  message: z.string().describe("Commit message."),
});


/**
 * The requester tag, and a refusal if the agent wrote one itself.
 *
 * The tag decides who hears about this work later, and the run that writes it is the
 * run being reported on. An agent that can set it can redirect the report of its own
 * failure, or address it to a name nobody reads and be silent in effect. Neither
 * needs intent: a login is a word, and agents repeat words they have read.
 *
 * `create_pr` has refused this since its parent-issue tag was added; `create_issue`
 * did not, and the asymmetry was load-bearing. `NOTIFY_TAG.read` returns the first
 * match, so the machine's tag wins while there is one -- and when the requester is
 * unknown there is none, which left the agent's as the only tag in the body.
 */
function notifyTagPrefix(body: string, what: string): string {
  if (NOTIFY_TAG.has(body)) mcpFail(`${what} body already contains a notify tag; refusing to add another`);
  const login = (process.env.ISSUE_NOTIFY ?? "").trim();
  return login ? `${NOTIFY_TAG.write(login)}\n` : "";
}

async function createIssue(a: z.infer<typeof CREATE_ISSUE_SCHEMA>): Promise<string> {
  const title = a.title;
  let body = a.body ?? "";
  let labels = a.labels ?? [];
  const sub = a.sub_issue ?? true;
  const parentNum = (process.env.ISSUE_NUMBER ?? "").trim();

  body = notifyTagPrefix(body, "Issue") + withCheckedMentions(body);
  if (sub) {
    const subIssueLabel = getLabel("sub_issue");
    const ensured = gh(
      "label", "create", subIssueLabel,
      "--repo", REPO,
      "--force",
      "--color", "8250df",
      "--description", "Child delivery task managed by Atomaton",
    );
    if (ensured.code) mcpFail(`Failed to ensure sub-issue label '${subIssueLabel}': ${ensured.stderr || ensured.stdout}`);
    if (!labels.includes(subIssueLabel)) labels = [...labels, subIssueLabel];
  }

  const cmd = ["issue", "create", "--repo", REPO, "--title", title];
  if (body) cmd.push("--body", body);
  for (const l of labels) cmd.push("--label", l);

  const { code, stdout, stderr } = gh(...cmd);
  if (code) mcpFail(stderr || stdout);
  const num = Number(stdout.trim().split("/").pop());
  if (!Number.isFinite(num)) mcpFail(`gh issue create: unexpected output: ${stdout.slice(0, 300)}`);

  // The link IS the record now, so a failure here is a failure of `create_issue`.
  //
  // This used to be best-effort, logged without a severity word, because the
  // `atomaton:parent` tag in the body was what aggregation read and the link was "the
  // cosmetic half". The tag is gone — it recorded the parent at creation and nothing
  // ever rewrote it, so a person re-parenting a sub-issue in the web UI left two
  // answers in the system. See `adapters/github/parent-issue.ts`.
  //
  // The issue exists by this point and cannot be un-created, so the failure names it:
  // an agent that is told only "create_issue failed" would file it again.
  if (sub && parentNum) {
    try {
      const pid = await resolveIssueId(Number(parentNum));
      const sid = await resolveIssueId(num);
      ghGraphql(
        "mutation($parent:ID!,$sub:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$sub,replaceParent:true}){issue{number}}}",
        { parent: pid, sub: sid },
      );
      log(`Linked sub-issue #${num} to parent #${parentNum} via official sub-issues API`);
    } catch (e) {
      mcpFail(
        `Issue #${num} was created, but could not be linked under #${parentNum} as a sub-issue: ${e}. ` +
          `Nothing records that edge except the link, so #${num} is currently a root issue and no aggregation ` +
          `will pick it up. Do not create it again — add it under #${parentNum} in the web UI, or retry the link.`,
      );
    }
  }

  logOp("create_issue", { number: num, title, sub_issue: sub });
  // `parent` is returned because asking for a sub-issue does not guarantee getting
  // one. With `sub_issue: true` and no `ISSUE_NUMBER` -- a run that is not working on
  // an issue -- the label goes on and there is no parent to link it under, producing
  // an issue that looks like a child and that no aggregation will ever pick up.
  // `{number, url}` reported that as plain success.
  //
  // The other way of ending up here is gone: a failed link is now a failed call, so
  // reaching this line with `parent` set means the link exists.
  const parent = sub && parentNum ? Number(parentNum) : null;
  return JSON.stringify({
    number: num,
    url: stdout.trim(),
    parent,
    ...(sub && !parent
      ? {
          note:
            "Labelled as a sub-issue, but this run has no current issue, so no parent was recorded. " +
            "Nothing will aggregate it. Create it from a run that is working on the parent, or treat it " +
            "as a root issue.",
        }
      : {}),
  });
}

/**
 * A sub-issue as a reader wants it: without the labels the gates judge it by.
 *
 * `issueLinks` fetches those in the same request, because `sibling-check.ts` and the
 * work tree need them and a second read per child would be the alternative. Nothing a
 * model is shown asks "which labels does each child carry", so they are dropped here
 * rather than not fetched — the cost of carrying them is one array per child in a
 * response, and the cost of not fetching them is a round trip each.
 */
function shownChildren(children: readonly LinkedChild[]): LinkedIssue[] {
  return children.map(({ labels: _judgedBy, ...shown }) => shown);
}

/**
 * The issue itself, and what it is attached to — without the conversation.
 *
 * The comments used to come back here too, which made every lookup of an
 * issue's state or labels drag its whole discussion in with it. The runner
 * already puts the current issue's comments in the prompt, so for the common
 * case that payload was a second copy; for any other issue it was an unbounded
 * read nobody asked for. `get_issue_comments` returns them, in a range.
 */
function getIssue(a: z.infer<typeof ISSUE_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const number = issueContextNumber(a);
  const issue = ghJsonOrThrow<{ comments?: unknown[]; body?: unknown }>(
    "issue", "view", String(number), "--repo", REPO,
    "--json", "number,title,body,state,labels,createdAt,closedAt,comments",
  );
  const { comments, body, ...rest } = issue ?? {};
  const links = issueLinks(REPO, number);
  return JSON.stringify({
    ...rest,
    // An issue body is text a person wrote and has no bound. Most are short; the
    // ones that are not tend to be the ones with a log or a table pasted in, and
    // that arrives once per lookup and then stays in the session forever.
    body: typeof body === "string" ? capText(body).text : body,
    total_comments: comments?.length ?? 0,
    parent: links.parent,
    children: shownChildren(links.children),
    pull_requests: links.pullRequests,
    // Empty because there are none, or empty because nobody could look? The
    // three fields above cannot say, and the difference decides whether
    // "no open pull request" means the work landed or means nothing is known.
    ...(links.unavailable ? { links_unavailable: links.unavailable } : {}),
  });
}

function listIssues(a: z.infer<typeof LIST_ISSUES_SCHEMA>): string {
  const state = a.state ?? "open";
  const limit = a.limit ?? 30;
  const labels = a.labels ?? [];
  const cmd = ["issue", "list", "--repo", REPO, "--state", state, "--limit", String(limit), "--json", "number,title,state,labels"];
  for (const l of labels) cmd.push("--label", l);
  return JSON.stringify(ghJsonOrThrow(...cmd) ?? []);
}

/**
 * A range of one issue's comments, carrying enough of the issue to be read
 * alone.
 *
 * The header is not redundancy. This tool is reached from a search result that
 * named a comment number, so it is entirely normal for it to be the only call
 * made about that issue — and a comment read without knowing which issue it
 * belongs to, whether that issue is still open, whether it is part of something
 * larger, and whether the work has actually landed is a comment that can be
 * read to mean the opposite of what it says. "Implemented it" on a sub-issue
 * whose pull request is still open is a proposal, not a fact. Making the result
 * carry that costs a few dozen tokens and removes a whole class of confident
 * wrong answers; requiring a prior `get_issue` call instead would only work
 * when the caller happens to make it.
 *
 * Labels are deliberately not here. What a repository's labels mean is up to
 * whoever adopted this, so no claim can be made that knowing them changes how
 * the words are read.
 */
function getIssueComments(a: z.infer<typeof ISSUE_COMMENTS_SCHEMA>): string {
  const number = issueContextNumber(a);
  const issue = ghJsonOrThrow<{ title?: string; state?: string; comments?: unknown[] }>(
    "issue", "view", String(number), "--repo", REPO, "--json", "title,state,comments",
  );
  const all = (issue?.comments ?? []).map((comment, i) => ({ index: i + 1, ...(comment as object) }));

  // The four interacting defaults live in `domain/work/comment-range.ts`, where the
  // truth table is testable without a `gh` in the loop.
  const range = selectCommentRange(all.length, a.from, a.to);
  // Capped per comment AND as a whole. The range bounds how MANY comments come
  // back and says nothing about how big one is, so a single comment with a log
  // pasted into it filled the window while `showing` reported three of forty.
  const selected = (range.count > 0 ? all.slice(range.from - 1, range.to) : []).map((comment) => {
    const body = (comment as { body?: unknown }).body;
    return typeof body === "string" ? { ...comment, body: capText(body, PER_ITEM_BUDGET).text } : comment;
  });

  const links = issueLinks(REPO, number);
  return JSON.stringify({
    issue: {
      number,
      title: issue?.title,
      state: issue?.state,
      total_comments: all.length,
      parent: links.parent,
      // `children` was the one of the three this header did not carry, and nothing
      // said why: the same `issueLinks` call already has it, so it cost nothing to
      // leave out and nothing to put back. What it costs to omit is the question a
      // reviewer asks most often of a parent — "is anything under this still open"
      // — answered by the comments alone, which cannot answer it.
      children: shownChildren(links.children),
      pull_requests: links.pullRequests,
      // See `get_issue`: an unread link list is not an empty one, and this
      // header exists precisely so a comment is not read as settled work.
      ...(links.unavailable ? { links_unavailable: links.unavailable } : {}),
    },
    // Always stated, never implied. A truncated read that looks complete is how
    // a caller concludes something is absent when it was merely not shown -- and
    // an empty one has to say why it is empty, or it reads as "nothing is there".
    showing: range.showing,
    comments: selected,
  });
}

/**
 * Close the issue, or ask the person who opened it to.
 *
 * This used to answer a person-opened issue with a tool ERROR -- "Refusing to
 * close issue #N: opened by a human, not a bot" -- and post nothing. Two things
 * were wrong with that, and `domain/work/close-request.ts` holds the measurement:
 * the error arrived at the moment the agent had decided it was finished, so it
 * went into the report as a paragraph about tools; and because an error posts no
 * comment, nobody was ever asked to close anything. The issue just stayed open
 * with a merged pull request against it.
 *
 * `atomaton__request_close_issue` had already settled the shape for the same
 * question and this tool disagreed with it. It is the canonical one: the tool
 * decides, it does not fail, and it leaves the request where a person will read
 * it.
 *
 * Returns whether the close actually happened, because the caller's aggregation
 * gate counts siblings and an issue that is still open is not one of them.
 */
function closeIssue(a: z.infer<typeof ISSUE_NUMBER_ARG_SCHEMA>): boolean {
  const num = a[ISSUE_NUMBER_ARG];
  log(`closeIssue: #${num}`);
  // NOTE: `gh issue view --json author` returns {id, is_bot, login, name} --
  // there is NO `.type` field (that only exists on the REST
  // `gh api repos/OWNER/REPO/issues/N` endpoint, as `.user.type`). Use the
  // reliable `.author.is_bot` boolean instead.
  const d = ghJsonOrThrow<GhIssueAuthor>("issue", "view", String(num), "--repo", REPO, "--json", "author");
  const isBot = Boolean(d?.author?.is_bot);
  log(`closeIssue: author.is_bot=${isBot}`);
  if (!isBot) {
    const body = closeRequestComment({
      notify: resolveNotify(REPO, num),
      body: "Atomaton: an agent finished the work on this issue and asked for it to be closed.",
    });
    const { code, stdout, stderr } = gh("issue", "comment", String(num), "--repo", REPO, "--body", body);
    // The one failure still worth an error. Saying nothing here would leave an
    // issue that nobody has been asked to close and an agent that believes
    // somebody has -- which is the defect above with the comment removed.
    if (code) mcpFail(`Could not ask for issue #${num} to be closed: ${stderr || stdout}`);
    logOp("close_issue", { number: num, closed: false });
    return false;
  }
  const { code, stdout, stderr } = gh("issue", "close", String(num), "--repo", REPO);
  if (code) mcpFail(stderr || stdout);
  logOp("close_issue", { number: num, closed: true });
  return true;
}

/**
 * Runs closeIssue()'s own logic, then -- whether this is a sub-issue closed
 * via the normal merge_pr path or via an origin-agent re-invocation
 * confirming its own work -- checks phase-gating/aggregation for its
 * parent, so it fires regardless of which path closed the issue.
 * dispatchOrchestratorIfSubIssueReady no-ops harmlessly if GitHub has #num under
 * nothing. Awaited by every caller (matching the original
 * Bun.spawnSync-based blocking behavior) so the tool response isn't
 * returned before phase-gating has actually run.
 *
 * The gate is skipped entirely when the close was only requested. Aggregation
 * asks whether every sibling is closed, and this one is not -- running it would
 * either answer "not yet" pointlessly or, worse, re-invoke a parent on the
 * strength of an issue that is still open.
 */
async function closeIssueAndDispatch(a: z.infer<typeof ISSUE_NUMBER_ARG_SCHEMA>): Promise<string> {
  const closed = closeIssue(a);
  const num = a[ISSUE_NUMBER_ARG];

  if (!closed) {
    // Success, stated as what happened rather than as what was declined. It says
    // the close was requested because an agent that believed it had closed the
    // issue would go on to tell a person so -- the honest half of the old refusal,
    // kept, with the part that read as a failure to work around removed.
    return JSON.stringify({
      ok: true,
      close_requested: num,
      note: "The issue's author was asked on the thread to close it.",
    });
  }

  // The aggregation outcome is part of what happened, so it goes in the result.
  // This used to be awaited and discarded, and `{ok: true}` was returned whether
  // the parent's orchestrator had been re-invoked, had been left waiting, or had
  // been skipped because something could not be read. The last of those leaves a
  // parent that nothing will ever come back to -- and the agent that closed the
  // issue is the last thing in a position to notice.
  let aggregation: DispatchGateResult;
  try {
    aggregation = await dispatchOrchestratorIfSubIssueReady(REPO, num);
  } catch (e) {
    const why = (e as Error).message ?? String(e);
    log(`closeIssueAndDispatch: aggregation check failed for #${num}: ${why}`);
    aggregation = { kind: "undetermined", why };
  }

  return JSON.stringify({
    ok: true,
    closed: num,
    aggregation: aggregation.kind,
    ...(needsAttention(aggregation)
      ? { note: describeGateResult(aggregation, num) }
      : {}),
  });
}

/**
 * An agent-written body, with mentions it cannot vouch for defused.
 *
 * The same check the result comment gets, for the same reason: a `@name` in an
 * issue or pull request body notifies a real account, and a name an agent read in
 * a commit log is a name it can repeat. See `domain/work/mention.ts`.
 *
 * The thread it checks against is the issue this run is working on. For a new
 * issue that is the parent's thread rather than its own, which does not exist yet
 * -- and is the right set anyway: the people already talking about this work.
 *
 * The notice goes in the body rather than being logged, because the body is where
 * somebody will see it. A run log is read when something has already gone wrong.
 */
/**
 * Refuse text GitHub would act on, before it becomes something GitHub has acted on.
 *
 * Two places only, and they are the two the documentation names: a pull request's
 * description, and a commit message. A keyword in an issue body, a pull request comment
 * or a review does nothing -- checked against GitHub's own documentation rather than
 * assumed, because a guard on a path that cannot fire is a rule somebody has to read and
 * obey for no reason.
 */
function refuseClosingKeywords(text: string, what: string): void {
  const refusal = closingKeywordRefusal(closingReferences(text), what);
  if (refusal !== undefined) mcpFail(refusal);
}

function withCheckedMentions(body: string): string {
  const checked = escapeUnknownMentions(
    body,
    knownParticipants(REPO, (process.env.ISSUE_NUMBER ?? "").trim()),
  );
  if (checked.escaped.length === 0) return body;
  log(`escaped ${checked.escaped.length} unconfirmed mention(s): ${checked.escaped.join(", ")}`);
  const notice = escapedMentionNotice(checked.escaped);
  return notice === undefined ? checked.text : `${checked.text}\n\n${notice}`;
}

function injectParentIssue(body: string): string {
  const parent = (process.env.ISSUE_NUMBER ?? "").trim();
  refuseClosingKeywords(body, "pull request body");
  body = notifyTagPrefix(body, "PR") + withCheckedMentions(body);
  if (!parent) return body;
  if (PARENT_ISSUE_TAG.has(body)) {
    mcpFail("PR body already contains a parent-issue tag; refusing to add another");
  }
  // Unconditionally, now that `refuseClosingKeywords` above guarantees the agent wrote
  // none of its own. This used to check first, because a second "Closes #N" made
  // downstream parsing match twice and corrupted $GITHUB_OUTPUT -- a duplicate that can
  // no longer arrive, since a body carrying one never reaches this line.
  const closesLine = `Closes #${parent}\n`;
  const originAgent = (process.env.AGENT ?? "").trim();
  const originLine = originAgent ? `${ORIGIN_AGENT_TAG.write(originAgent)}\n` : "";
  return `${PARENT_ISSUE_TAG.write(Number(parent))}\n${originLine}${closesLine}${body}`;
}

function createPr(a: z.infer<typeof CREATE_PR_SCHEMA>): McpToolResult {
  const title = a.title;
  let body = a.body ?? "";
  // Three answers, most specific first.
  //
  // An explicit `base` wins. Otherwise a sub-issue aims at its parent's branch,
  // so the parent's work accumulates in one place and reaches the base as a
  // single reviewed change. Otherwise `base_branch` — how an adopter says where
  // day-to-day work lands, since a repo that develops on `develop` cannot have
  // every agent PR aimed at the default branch. With none set, `gh` targets the
  // default branch.
  const base = a.base ?? stackedPrBase(REPO) ?? getBaseBranch();
  body = injectParentIssue(body);
  log(`createPr: title=${JSON.stringify(title)}, base=${JSON.stringify(base)}, REPO=${JSON.stringify(REPO)}`);

  const branch = resolveBranch();
  log(`createPr: resolved branch=${JSON.stringify(branch)}`);

  const worktree = gitRun("status", "--porcelain");
  if (worktree.code) mcpFail(worktree.stderr || worktree.stdout);
  if (worktree.stdout.trim()) {
    mcpFail("Cannot create a PR with uncommitted changes. Call github__commit_and_push first.");
  }
  const head = gitRun("rev-parse", "HEAD");
  if (head.code) mcpFail(`Cannot resolve local HEAD: ${head.stderr || head.stdout}`);
  const remote = gitRun("ls-remote", "--heads", "origin", `refs/heads/${branch}`);
  if (remote.code) mcpFail(`Cannot inspect remote branch '${branch}': ${remote.stderr || remote.stdout}`);
  const remoteHead = remote.stdout.trim().split(/\s+/, 1)[0] ?? "";
  if (!remoteHead) {
    mcpFail(`Remote branch '${branch}' does not exist. Call github__commit_and_push before creating the PR.`);
  }
  if (remoteHead !== head.stdout.trim()) {
    mcpFail(
      `Remote branch '${branch}' is not at local HEAD. Call github__sync_branch and inspect its status; ` +
      `if it reports 'ahead', call github__commit_and_push before creating the PR.`,
    );
  }

  const cmd = ["pr", "create", "--repo", REPO, "--title", title, "--head", branch];
  if (body) cmd.push("--body", body);
  if (base) cmd.push("--base", base);
  log(`createPr: running gh ${cmd.join(" ")}`);
  const { code, stdout, stderr } = gh(...cmd);
  log(`createPr: gh pr create rc=${code}, out=${JSON.stringify(stdout)}, err=${JSON.stringify(stderr)}`);
  if (code) mcpFail(`gh pr create failed (rc=${code}): ${stderr || stdout}`);

  const num = Number(stdout.trim().split("/").pop());
  if (!Number.isFinite(num)) mcpFail(`gh pr create: unexpected output: ${stdout.slice(0, 300)}`);

  logOp("create_pr", { number: num, title });
  // The reviewer is named by the caller now, not by an `auto_triggers` entry.
  // Opening a pull request used to start one through `pull_request.opened`, which
  // fired only for a HUMAN's pull request -- GitHub starts no workflow for an
  // event its own token caused -- so the trigger and this call were two halves of
  // one behaviour that looked like one half each. The trigger was removed and
  // asking became explicit.
  //
  // An empty name is a legitimate answer, and `atomaton-validate-pr` already handles
  // it: CI still runs, and nothing is dispatched afterwards. What it did not
  // handle is a person finding out, which is what `noticeNobodyIsComing` below is
  // for.
  const reviewer = (a.reviewer ?? "").trim();
  const validationDispatched = dispatchPrValidation(REPO, num, branch, reviewer);

  // Traceability: the reviewer dispatch above is fire-and-forget, and (since
  // this call now ends the session immediately, see the returned
  // meta.session_ends below) no further agent text will be posted on the
  // CURRENT issue about this -- record it here explicitly, the same way
  // dispatchSubAgent always confirms its own dispatch with a comment.
  const currentIssue = (process.env.ISSUE_NUMBER ?? "").trim();
  if (currentIssue) {
    const next = !validationDispatched
      ? "CI could NOT be started, so no required check will appear and no agent is scheduled. See the run log."
      : reviewer
        ? `Running CI; \`${reviewer}\` follows if it passes.`
        : "Running CI. No reviewer was named, so nothing is scheduled afterwards.";
    gh(
      "issue", "comment", currentIssue, "--repo", REPO,
      "--body", `${LLM_CONTEXT_TAG.write("exclude")}\nAtomaton: PR #${num} created (${stdout.trim()}). ${next}`,
    );
  }

  // Nobody coming, said out loud on the pull request itself.
  //
  // Asking is explicit now -- an agent names the reviewer, or a person types
  // `/reviewer` -- which removed a class of unwanted runs and created one silent
  // failure: a pull request opened with no reviewer and nobody mentioned just sits.
  // CI passes, the check goes green, and the work waits for someone who was never
  // told. The old triggers made that impossible; making asking explicit made
  // forgetting possible.
  //
  // Not tagged `llm-context=exclude`, unlike the confirmation above: this one is a
  // fact about the pull request that a later agent reading the thread should see.
  // The confirmation is bookkeeping; this is "nobody is coming".
  if (!isAttended({ ...(reviewer ? { next: { agent: reviewer } } : {}), body: body ?? "" })) {
    const openedBy = (process.env.AGENT ?? "").trim() || "an agent";
    const notify = resolveNotify(REPO, num);
    log(`createPr: PR #${num} has no reviewer and mentions nobody; leaving a notice for ${notify || "(nobody resolved)"}`);
    gh("pr", "comment", String(num), "--repo", REPO, "--body", unattendedNotice(notify, openedBy));
  }

  // From the calling agent's (engineer's) perspective, create_pr should
  // behave like launch_sub_agent: a normal-looking synchronous tool call
  // that, once it returns, immediately ends this session. The agent is
  // re-invoked later (see dispatchPostMergeAgent) once the PR actually
  // concludes (merged, or sent back via changes_requested), at which point
  // that re-invocation is framed as the deferred continuation of this exact
  // call -- not a brand-new unrelated task. This keeps the engineer's own
  // run from continuing to execute concurrently with the reviewer run just
  // dispatched above (the whole point of the "serial" design).
  // `session_ends` only when something is actually going to happen next.
  //
  // This used to be unconditional, and `dispatchPrValidation` returned void, so
  // a failed dispatch ended the engineer's session having reported success: no
  // CI, no required check, no agent re-invoked, and a pull request that sits
  // until a person finds it. The engineer is the only thing still able to fix
  // that, and it was the thing being told to stop.
  //
  // `base` is returned for the same reason. It is resolved from three places
  // (the argument, the parent's branch when this is a sub-issue, the project's
  // configured base), and which one won decides whether merging this deploys.
  return {
    text: JSON.stringify({
      number: num,
      url: stdout.trim(),
      base,
      validation_dispatched: validationDispatched,
      ...(validationDispatched
        ? {}
        : {
            note:
              "The pull request exists, but CI could not be started, so no required check will be written " +
              "and no agent is scheduled to continue. Retry with github__commit_and_push, which dispatches " +
              "validation again, or report this so a person can start it.",
          }),
    }),
    meta: validationDispatched ? { session_ends: true } : {},
  };
}


function commitAndPush(a: z.infer<typeof COMMIT_AND_PUSH_SCHEMA>): string {
  const message = a.message;
  // Before anything is written. A commit message is the other place GitHub acts on a
  // closing keyword, and the harder of the two to notice afterwards: it is not in the
  // pull request's diff, and nobody opens the commit list to check.
  refuseClosingKeywords(message, "commit message");
  // Before the commit, so a failure to name a branch does not leave a commit
  // stranded on the base branch.
  const branch = branchForCommit(REPO);
  {
    const { code, stdout, stderr } = gitRun("add", "-A");
    if (code) mcpFail(stderr || stdout);
  }
  // "nothing to commit" is not a failure to commit; it is having nothing to commit.
  // It happened 23 times, and failing here skipped the push below -- so an agent that
  // had committed through the shell and called this to publish the work got an error
  // and a branch that never reached origin. The push is the part that still had
  // something to do, so fall through to it and report honestly that nothing was
  // committed. `git push` on an already-published branch exits 0 saying so.
  let committed = true;
  {
    const result = gitRun("commit", "-m", message);
    if (result.code) {
      if (!nothingToCommit(result)) mcpFail(result.stderr || result.stdout);
      committed = false;
    }
  }
  let pushed = true;
  {
    const { code, stdout, stderr } = gitRun("push", "-u", "origin", branch);
    if (code) mcpFail(stderr || stdout);
    pushed = !/Everything up-to-date/i.test(`${stdout} ${stderr}`);
  }

  // Only when something moved.
  //
  // The runner reads this log to decide whether a run changed anything, and stops a
  // chain that has stopped moving. Letting the commit through when the tree was clean
  // was right -- there was a commit waiting to be pushed -- but a call that commits
  // nothing AND pushes nothing must not register as progress, or the fix to one
  // failure would have quietly disarmed a guard against another.
  const moved = committed || pushed;
  if (moved) logOp("commit_and_push", { committed });

  // A push to a branch that already has a pull request has to be validated the
  // same way the first push was. Nothing else will do it: GitHub raises no event
  // for a push made with GITHUB_TOKEN, so neither CI nor any routing workflow
  // hears about this commit, and the pull request would keep whatever check the
  // previous head commit had -- on a commit that is no longer the head, so the
  // ruleset sees the required context as missing and the merge stays refused.
  //
  // Skipped when there is no pull request yet, which is the ordinary first push:
  // `create_pr` dispatches validation itself once the pull request exists, and
  // validating a branch with nothing to merge into would only burn a CI run.
  //
  // Repeated pushes within one run each dispatch, and the validation workflow's
  // own concurrency group collapses them, keeping the last.
  const open = moved
    ? gh("pr", "list", "--repo", REPO, "--head", branch, "--state", "open", "--json", "number")
    : { code: 1, stdout: "", stderr: "" };
  if (moved && !open.code) {
    try {
      const [pr] = JSON.parse(open.stdout || "[]") as { number: number }[];
      // No reviewer. This dispatch exists to refresh the required check on the new
      // head commit, which is about whether the pull request CAN merge -- a
      // different question from whether anyone should look at it.
      //
      // `pull_request.synchronize` used to start a reviewer here, and only for a
      // person's push. It was removed: nothing starts unless someone asks. An
      // agent that pushed a fix and wants it reviewed hands off by naming the
      // reviewer as its directive, which is the path the handoff limit covers.
      if (pr) dispatchPrValidation(REPO, pr.number, branch, "");
    } catch {
      // This call's result is `{ok: true}` and validation was not started. An
      // agent that pushed and expects CI to run would be waiting for something
      // that is not coming, so the discrepancy has to reach it, not the log.
      report(
        "warning",
        "could not read the open pull request list, so CI validation was NOT dispatched for this push",
      );
    }
  }

  // `committed: false, pushed: false` is the honest report of a call that found nothing
  // to do. It used to be an error, which stopped the run; it is a fact the agent can
  // read and act on, and saying it plainly is better than either failing or implying
  // work was published.
  return JSON.stringify({ ok: true, committed, pushed });
}

function syncBranch(a: z.infer<typeof SYNC_BRANCH_SCHEMA>): string {
  const branch = a.branch?.trim() || resolveBranch();
  const valid = gitRun("check-ref-format", "--branch", branch);
  if (valid.code) mcpFail(`Invalid branch name '${branch}': ${valid.stderr || valid.stdout}`);
  const current = gitRun("branch", "--show-current");
  if (current.code) mcpFail(current.stderr || current.stdout);
  if (current.stdout.trim() !== branch) {
    mcpFail(`Cannot synchronize '${branch}' while '${current.stdout.trim() || "detached HEAD"}' is checked out.`);
  }

  const worktree = gitRun("status", "--porcelain");
  if (worktree.code) mcpFail(worktree.stderr || worktree.stdout);
  if (worktree.stdout.trim()) {
    mcpFail("Cannot synchronize a branch with uncommitted changes. Commit or discard them first.");
  }

  const remoteRef = `refs/remotes/origin/${branch}`;
  const fetch = gitRun("fetch", "origin", `refs/heads/${branch}:${remoteRef}`);
  if (fetch.code) {
    if (/couldn't find remote ref|not our ref/i.test(fetch.stderr)) {
      return JSON.stringify({ branch, status: "remote_missing", ahead: 0, behind: 0 });
    }
    mcpFail(`Failed to fetch remote branch '${branch}': ${fetch.stderr || fetch.stdout}`);
  }

  const counts = gitRun("rev-list", "--left-right", "--count", `HEAD...${remoteRef}`);
  if (counts.code) mcpFail(`Failed to compare branch '${branch}': ${counts.stderr || counts.stdout}`);
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    mcpFail(`Unexpected rev-list output for branch '${branch}': ${counts.stdout}`);
  }

  if (ahead === 0 && behind! > 0) {
    const fastForward = gitRun("merge", "--ff-only", remoteRef);
    if (fastForward.code) mcpFail(`Failed to fast-forward branch '${branch}': ${fastForward.stderr || fastForward.stdout}`);
    logOp("sync_branch", { branch, status: "fast_forwarded", ahead, behind });
    return JSON.stringify({ branch, status: "fast_forwarded", ahead, behind });
  }

  const status = ahead! > 0 && behind! > 0 ? "diverged" : ahead! > 0 ? "ahead" : "up_to_date";
  logOp("sync_branch", { branch, status, ahead, behind });
  return JSON.stringify({ branch, status, ahead, behind });
}

/**
 * The most one item of a list may contribute.
 *
 * A fifth of the whole, so five long comments fill the budget rather than the
 * first one doing it alone. A count limit is not a volume limit: `get_issue_comments`
 * bounds how MANY comments it returns and said nothing about how big one may be, so
 * a single comment with a pasted log in it filled the window while the tool
 * reported having shown three of forty.
 */
const PER_ITEM_BUDGET = Math.floor(TOOL_OUTPUT_BUDGET / 5);

/**
 * Fields of one REST object, and nothing else.
 *
 * Every tool below that reached `gh api` returned the response whole. That is not
 * a small waste: a tool result joins the session and is resent on every later
 * inference in it, so an unread field is rent charged for the rest of the issue's
 * life. Measured on this repository:
 *
 *   get_check_runs   24,954 -> 1,363 bytes   (18x; `app` is 2,244 bytes PER RUN,
 *                                             the same App description eight times)
 *   get_branch       11,614 ->    81 bytes   (143x; `commit` is 11,164 of it)
 *   get_pr_reviews      905 ->   ~400 bytes  (2x; already trimmed by `gh --json`)
 *
 * A projection is strictly better than a cap: the cap loses information and this
 * loses none. Note the pattern in those numbers -- the tools using `gh --json`
 * were already light and the ones using `gh api` were heavy, because `gh --json`
 * makes you name what you want.
 *
 * `unknown` in, typed out: these come from `ghJsonOrThrow`, and asserting a shape
 * that GitHub might change would be a lie the compiler believes.
 */
function pick<K extends string>(source: unknown, keys: readonly K[]): Partial<Record<K, unknown>> {
  if (typeof source !== "object" || source === null) return {};
  const record = source as Record<string, unknown>;
  const out: Partial<Record<K, unknown>> = {};
  for (const key of keys) if (record[key] !== undefined) out[key] = record[key];
  return out;
}

function getPr(a: z.infer<typeof PR_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const pr = ghJsonOrThrow<{ body?: unknown }>(
    "pr", "view", String(prContextNumber(a)), "--repo", REPO,
    "--json", "number,title,body,state,baseRefName,headRefName,createdAt",
  );
  const { body, ...rest } = pr ?? {};
  // Same as `get_issue`: the description is the one unbounded field here.
  return JSON.stringify({ ...rest, body: typeof body === "string" ? capText(body).text : body });
}

function getPrDiff(a: z.infer<typeof PR_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const { code, stdout, stderr } = gh("pr", "diff", String(prContextNumber(a)), "--repo", REPO);
  if (code) mcpFail(stderr || stdout);
  // `head`: a diff's first files are the subject of the change. And the cut is now
  // announced in the text rather than being a silent `slice` -- a truncated read
  // that looks complete is how a reviewer concludes a file was not touched.
  return capText(stdout).text;
}

function listPrs(a: z.infer<typeof LIST_PRS_SCHEMA>): string {
  const state = a.state ?? "open";
  const limit = a.limit ?? 30;
  return JSON.stringify(ghJsonOrThrow("pr", "list", "--repo", REPO, "--state", state, "--limit", String(limit), "--json", "number,title,state,headRefName,baseRefName") ?? []);
}

/**
 * How long to keep waiting out a rate limit before reporting one.
 *
 * GitHub allows ten code searches a minute, which is why this was the most-failed
 * read in the catalog: 30 refusals, all quota, none of them anything the query could
 * have avoided. A 429 names its own wait -- "try again in 2.32s" -- so most of these
 * are two seconds away from succeeding, and the agent was paying an iteration for
 * each one instead.
 *
 * Bounded, because the run holds a runner while it sleeps. Two minutes clears the
 * per-minute limit comfortably; the hourly installation limit it will not clear, and
 * sitting on a runner for an hour to find that out is worse than saying so.
 */
const SEARCH_WAIT_BUDGET_MS = 120_000;

/** The wait GitHub stated, in ms, when it stated one. */
function statedWait(text: string): number | undefined {
  const match = /try again in ([0-9.]+)s/i.exec(text);
  if (!match) return undefined;
  return Math.min(60_000, Math.ceil(Number(match[1]) * 1000));
}

function searchCode(a: z.infer<typeof SEARCH_CODE_SCHEMA>): string {
  const backoff = [5_000, 15_000, 30_000, 60_000];
  let waited = 0;
  for (let attempt = 0; ; attempt += 1) {
    const { code, stdout, stderr } = gh("search", "code", a.query, "--repo", REPO, "--limit", "30");
    if (!code) return capText(stdout).text;
    const text = `${stderr} ${stdout}`;
    // Both shapes GitHub uses: 429 for the per-minute limit, 403 for the installation
    // quota. Anything else is a real failure and is reported as it always was.
    if (!/HTTP 429|rate limit/i.test(text)) mcpFail(stderr || stdout);
    const delay = statedWait(text) ?? backoff[Math.min(attempt, backoff.length - 1)] ?? 60_000;
    if (waited + delay > SEARCH_WAIT_BUDGET_MS) {
      mcpFail(
        `GitHub's code search quota is still exhausted after waiting ${Math.round(waited / 1000)}s, ` +
          "so this search did not run. For code in this repository use search__search_code, " +
          "which reads the checkout and has no quota. This tool is the one to use for a " +
          "repository that is not checked out, and it will be available again shortly.",
      );
    }
    Bun.sleepSync(delay);
    waited += delay;
  }
}

/**
 * Branch metadata, or a plain report that there is no such branch.
 *
 * The comment below used to describe this as serving "a caller asking whether a
 * branch exists" while the only available answer to that question was a thrown 404.
 * Six calls in the recorded sessions asked about `atomaton/issue-104`, `atomaton/issue-190`
 * and `atomaton/issue-219` before creating them, and each was charged an error for
 * asking. A tool that cannot say "no" makes every correct check look like a fault,
 * and it buries the 404s that ARE faults among them.
 *
 * Only 404 becomes an answer. A 403 or a 500 is still the absence of one, and
 * reporting "this branch does not exist" because GitHub was unreachable would be a
 * confident lie in the one place a caller is deciding whether to create something.
 */
function getBranch(a: z.infer<typeof GET_BRANCH_SCHEMA>): string {
  const found = gh("api", `repos/${REPO}/branches/${a.branch}`);
  if (found.code) {
    const text = `${found.stderr} ${found.stdout}`;
    if (/HTTP 404|Branch not found|Not Found/i.test(text)) {
      return JSON.stringify({ branch: a.branch, exists: false });
    }
    mcpFail(found.stderr || found.stdout);
  }
  // 11,614 bytes to 81. The whole `commit` object -- author, committer, tree,
  // parents, verification and the message -- was 11,164 of it, for a caller asking
  // whether a branch exists and what its head is.
  const branch = (found.stdout ? JSON.parse(found.stdout) : {}) as {
    name?: string;
    commit?: { sha?: string };
    protected?: boolean;
  };
  return JSON.stringify({
    branch: branch.name,
    exists: true,
    sha: branch.commit?.sha,
    protected: branch.protected,
  });
}

function getCheckRuns(a: z.infer<typeof GET_CHECK_RUNS_SCHEMA>): string {
  const d = ghJsonOrThrow<{ check_runs?: unknown[] }>("api", `repos/${REPO}/commits/${a.ref}/check-runs`);
  // `html_url` and not `output`: the summary GitHub puts in `output` is usually
  // empty and never the failure, and the URL is what a reader follows to the log.
  // `details_url` is dropped as a near-duplicate of it.
  return JSON.stringify((d?.check_runs ?? []).map((run) => pick(run, ["name", "status", "conclusion", "html_url"])));
}

function getPrReviews(a: z.infer<typeof PR_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const d = ghJsonOrThrow<{ reviews?: unknown[] }>(
    "pr", "view", String(prContextNumber(a)), "--repo", REPO, "--json", "reviews",
  );
  // `reactionGroups`, `includesCreatedEdit` and `authorAssociation` are dropped:
  // nothing an agent does with a review depends on them. Each body is capped on its
  // own, because a count of reviews says nothing about the size of one.
  const reviews = (d?.reviews ?? []).map((review) => {
    const kept = pick(review, ["author", "state", "submittedAt"]);
    const body = (review as { body?: unknown }).body;
    return { ...kept, body: typeof body === "string" ? capText(body, PER_ITEM_BUDGET).text : body };
  });
  // Whole reviews go, not a slice of the JSON: cutting the array mid-string
  // returns text that no longer parses. `omitted` is what stops "not shown" being
  // read as "not there".
  const { kept, omitted } = fitItems(reviews);
  return JSON.stringify({ total: reviews.length, omitted, reviews: kept });
}

function listPrReviewComments(a: z.infer<typeof PR_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const comments =
    ghJsonOrThrow<unknown[]>(`api`, `repos/${REPO}/pulls/${prContextNumber(a)}/comments`) ?? [];
  // The raw REST review comment carries about thirty fields, including a `user`
  // object of roughly a kilobyte to convey one login and a `diff_hunk` repeating
  // code the caller can read from the diff. What acting on a review comment needs
  // is where it is and what it says.
  const projected = comments.map((comment) => {
    const record = (typeof comment === "object" && comment !== null ? comment : {}) as Record<string, unknown>;
    const user = record.user as { login?: unknown } | undefined;
    const body = record.body;
    return {
      author: user?.login,
      path: record.path,
      line: record.line ?? record.original_line,
      in_reply_to: record.in_reply_to_id,
      body: typeof body === "string" ? capText(body, PER_ITEM_BUDGET).text : body,
    };
  });
  const { kept, omitted } = fitItems(projected);
  return JSON.stringify({ total: projected.length, omitted, comments: kept });
}

/** True if `number` is currently closed (used to skip a pointless post-merge re-invocation when native "Closes #N" auto-close already did the job). */
function isIssueClosed(number: number): boolean {
  const d = ghJsonOrThrow<{ state?: string }>("issue", "view", String(number), "--repo", REPO, "--json", "state");
  return (d?.state ?? "").toUpperCase() === "CLOSED";
}


function checkMergeReadiness(a: z.infer<typeof PR_CONTEXT_NUMBER_ARG_SCHEMA>): string {
  const num = prContextNumber(a);
  const { signals, refs } = gatherMergeSignals(REPO, num, mcpFail);
  const headRefName = refs.headRefName;
  const readiness = decideMergeReadiness(signals);

  const dispatched = readiness.needsCiDispatch && headRefName ? dispatchCi(headRefName) : false;

  return JSON.stringify({
    number: num,
    ready: readiness.ready,
    blockers: readiness.blockers,
    // The branch protection this verdict came from, so a refusal is auditable
    // rather than an assertion: `merge_state_status` is GitHub's own evaluation
    // and `required_checks` is what the ruleset currently demands.
    merge_state_status: signals.mergeStateStatus,
    required_checks: signals.requiredChecks,
    checks: signals.checks.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
    ci_dispatched: dispatched,
    summary: readiness.ready
      ? "Ready to merge."
      : `Not mergeable:\n${formatBlockers(readiness.blockers)}` +
        (dispatched ? "\n\nCI has been dispatched for the head commit; re-check shortly." : ""),
  });
}

/**
 * Deletes the branch a merged pull request came from.
 *
 * A branch now appears only when a run commits, but an implemented issue still
 * leaves one behind for good, and they accumulate one per issue. Its work is in
 * the base by the time this runs, so the branch holds nothing the base does not.
 *
 * Deleting it is also what lets the next piece of work on the same issue take
 * the plain `atomaton/issue-N` name again: with the merged branch gone, nothing is
 * left to count up from, and the new branch is cut from the base rather than
 * from released history — the same outcome the suffix exists to produce.
 *
 * Never fails the merge. The merge is the outcome the agent was asked for, and a
 * branch that outlives it is untidy, not broken.
 */
function deleteMergedBranch(branch: string): void {
  if (!branch) return;
  const { code, stderr, stdout } = gh("api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${branch}`);
  if (code) {
    // The merge is done and this does not undo it, but a token that cannot delete
    // a ref is an environment fault -- and this repository accumulated 72 stray
    // branches once already.
    report("warning", `merged, but could not delete the branch ${branch}: ${stderr || stdout}`);
    return;
  }
  log(`mergePr: deleted merged branch ${branch}`);
}

async function mergePr(a: z.infer<typeof PR_NUMBER_ARG_SCHEMA>): Promise<string> {
  const num = a[PR_NUMBER_ARG];

  // The gate, applied on the path every agent merge takes. The verdict itself is
  // the repository's own branch protection, re-read here rather than restated —
  // see domain/delivery/merge-readiness.ts. It is applied at this call site because an
  // agent merge is made with GITHUB_TOKEN, which the ruleset must exempt in order
  // to let the deployment job publish, so protection alone would not stop it.
  const { signals, refs } = gatherMergeSignals(REPO, num, mcpFail);
  const { headRefName, baseRefName } = refs;
  const readiness = decideMergeReadiness(signals);
  if (!readiness.ready) {
    log(`mergePr: refusing PR #${num} — ${readiness.blockers.map((b) => b.kind).join(", ")}`);
    const dispatched = readiness.needsCiDispatch && headRefName ? dispatchCi(headRefName) : false;
    return JSON.stringify({
      merged: false,
      blockers: readiness.blockers,
      ci_dispatched: dispatched,
      reason: `Not mergeable:\n${formatBlockers(readiness.blockers)}`,
    });
  }

  const { code, stdout, stderr } = gh("pr", "merge", String(num), "--repo", REPO, "--squash");
  log(`mergePr: gh pr merge rc=${code}, out=${JSON.stringify(stdout)}, err=${JSON.stringify(stderr)}`);
  if (code) mcpFail(`gh pr merge failed (rc=${code}): ${stderr || stdout}`);
  logOp("merge_pr", { number: num });
  deleteMergedBranch(headRefName);

  // Nothing else will: this merge produced no `push` event, because GitHub starts
  // no workflow run for events GITHUB_TOKEN triggers.
  dispatchCd(baseRefName);

  const d = ghJsonOrThrow<{ body?: string }>("pr", "view", String(num), "--repo", REPO, "--json", "body");
  const body = d?.body ?? "";
  const parentIssue = PARENT_ISSUE_TAG.read(body);

  const handoff = decidePostMergeHandoff({
    parentIssue,
    parentAlreadyClosed: parentIssue !== undefined && isIssueClosed(parentIssue),
    originAgent: ORIGIN_AGENT_TAG.read(body),
  });

  switch (handoff.kind) {
    case "no-parent":
      // Four different things used to serialise to the identical
      // `{merged: true, closed_issue: null}`: no parent, the parent was already
      // closed, the close failed, and the re-invocation was dispatched instead.
      // Only one of those leaves an issue open that should not be, and it was
      // the one the agent could not see -- the failure went to this server's
      // stderr. `parent_outcome` names which happened.
      return JSON.stringify({ merged: true, closed_issue: null, parent_outcome: "no-parent" });
    case "already-closed":
      log(`mergePr: parent issue #${handoff.parentIssue} already closed -- skipping post-merge re-invocation`);
      return JSON.stringify({
        merged: true,
        closed_issue: null,
        parent_issue: handoff.parentIssue,
        parent_outcome: "already-closed",
        note: "GitHub closed the parent itself, from a \"Closes #N\" line. Nothing further was needed.",
      });
    case "reinvoke-origin-agent":
      if (dispatchPostMergeAgent(REPO, handoff.parentIssue, handoff.agent)) {
        return JSON.stringify({
          merged: true,
          closed_issue: null,
          parent_issue: handoff.parentIssue,
          parent_outcome: "reinvoked",
          reinvoked_agent: handoff.agent,
        });
      }
      // The preferred handoff (re-invoking the origin agent) failed to
      // dispatch -- fall back to closing the parent directly ourselves,
      // same as the "close-directly" case below.
      return await closeParentAndReport(handoff.parentIssue);
    case "close-directly":
      return await closeParentAndReport(handoff.parentIssue);
  }
}

/** closeIssueAndDispatch also triggers phase-gating/aggregation itself. Shared by mergePr()'s "close-directly" case and its "reinvoke failed" fallback. */
async function closeParentAndReport(parentIssue: number): Promise<string> {
  try {
    // Read, not discarded. `closeIssueAndDispatch` stopped throwing when the author
    // is a person: it asks them on the thread and reports success. A caller that
    // ignores the answer therefore reports a parent as closed while it is open --
    // which is the failure this change exists to remove, and discarding the return
    // value here would have moved it rather than fixed it.
    const outcome = JSON.parse(await closeIssueAndDispatch({ [ISSUE_NUMBER_ARG]: parentIssue })) as {
      close_requested?: number;
    };
    if (outcome.close_requested !== undefined) {
      return JSON.stringify({
        merged: true,
        closed_issue: null,
        parent_issue: parentIssue,
        parent_outcome: "close-requested",
        note: `The pull request merged. Issue #${parentIssue} was opened by a person, so it was not closed -- they have been asked on the thread to close it. Nothing further is needed from you.`,
      });
    }
    return JSON.stringify({
      merged: true,
      closed_issue: parentIssue,
      parent_issue: parentIssue,
      parent_outcome: "closed",
    });
  } catch (e) {
    const why = (e as Error).message ?? String(e);
    log(`mergePr: could not close parent issue #${parentIssue}: ${why}`);
    // The one outcome that leaves work undone. The merge happened, the parent
    // is still open, and nothing is scheduled to close it -- so the caller is
    // told, rather than being handed the same shape as "there was no parent".
    return JSON.stringify({
      merged: true,
      closed_issue: null,
      parent_issue: parentIssue,
      parent_outcome: "close-failed",
      note: `The pull request merged, but issue #${parentIssue} could not be closed: ${why}. It is still open and nothing will retry. Close it with github__close_issue, or report it.`,
    });
  }
}

const { tools: TOOLS, dispatch: rawDispatch } = buildMcpTools([
  defineMcpTool({
    name: "create_issue",
    description: "Create a GitHub issue in the current repository and return its number and URL. Use this for durable work items, especially delegated child tasks; sub_issue defaults to true and links the new issue to the current issue. This mutates GitHub and records the operation in Atomaton's audit log.",
    schema: CREATE_ISSUE_SCHEMA,
    handler: createIssue,
  }),
  defineMcpTool({ name: "get_issue", description: "Retrieve one issue's title, body, state, labels, timestamps, comment count, and what it is attached to: its parent issue, its sub-issues, and the pull requests that say they close it (each marked merged or not). It does NOT return the comments themselves — use get_issue_comments for those, which takes a range. Returns a JSON issue object and does not mutate GitHub.", schema: ISSUE_CONTEXT_NUMBER_ARG_SCHEMA, handler: getIssue }),
  defineMcpTool({ name: "list_issues", description: "List issue summaries in the current repository, optionally filtered by state and labels. Use this to discover or scan issues; use get_issue when full body and comments are needed. Returns a JSON array and does not mutate GitHub.", schema: LIST_ISSUES_SCHEMA, handler: listIssues }),
  defineMcpTool({ name: "get_issue_comments", description: "Read a range of one issue's comments, numbered from 1 in the order they were posted. Pass `from` (and optionally `to`) to read exactly the comment a search result pointed at; with no range it returns the last few, and always states which of how many it showed. Each result also carries the issue's title, state, parent, and the pull requests that close it, so a comment read on its own is not mistaken for settled work when its pull request is still open. Returns JSON and does not mutate GitHub.", schema: ISSUE_COMMENTS_SCHEMA, handler: getIssueComments }),
  defineMcpTool({ name: "close_issue", description: "Conclude an issue whose work is complete, and trigger Atomaton parent-task aggregation when applicable. Whether the issue is closed now or the person who opened it is asked on the thread to close it is this tool's decision and not yours; it does not fail on either. Returns JSON and mutates GitHub.", schema: ISSUE_NUMBER_ARG_SCHEMA, guidance: omittedNumberGuidance("issue"), handler: closeIssueAndDispatch }),
  defineMcpTool({ name: "create_pr", description: "Create a pull request from the checked-out Atomaton branch and return its number, URL and resolved base. Call commit_and_push first: this tool requires a clean worktree and exact local/remote HEAD equality, and it never pushes for you. On success it dispatches CI validation -- NOT the reviewer directly: validation runs the checks and then dispatches whichever agent the result calls for, the reviewer when they pass and the engineer when they do not. Read `validation_dispatched`: when it is true the session ends here and you are re-invoked later; when it is false nothing is scheduled and the session stays open for you to act.", schema: CREATE_PR_SCHEMA, handler: createPr }),
  defineMcpTool({ name: "get_pr", description: "Retrieve one pull request's metadata, including state and base/head branches. Use this for PR status and identity; use get_pr_diff or review tools for code and review details. Returns a JSON object and does not mutate GitHub.", schema: PR_CONTEXT_NUMBER_ARG_SCHEMA, handler: getPr }),
  defineMcpTool({ name: "get_pr_diff", description: "Retrieve the unified diff for one pull request. Use this to review code changes; it does not include review conversations. Returns plain diff text and does not mutate GitHub. A large diff is truncated and says so in the text where the cut falls -- if you see that marker, the files after it were NOT shown and you have not seen the whole change.", schema: PR_CONTEXT_NUMBER_ARG_SCHEMA, handler: getPrDiff }),
  defineMcpTool({ name: "list_prs", description: "List pull request summaries in the current repository, optionally filtered by state. Use this to discover PRs; use get_pr for full metadata. Returns a JSON array and does not mutate GitHub.", schema: LIST_PRS_SCHEMA, handler: listPrs }),
  defineMcpTool({ name: "search_code", description: "Search code through GitHub within the current repository. Use this for remote repository text or symbol discovery when local filesystem search is unavailable; do not use it for uncommitted changes. Returns GitHub CLI search text; a long result is truncated and says so where the cut falls.", schema: SEARCH_CODE_SCHEMA, handler: searchCode }),
  defineMcpTool({ name: "get_branch", description: "Retrieve GitHub's branch metadata for an exact branch name, or report that no such branch exists. Use this to inspect remote branch identity and protection information, not local worktree state. A branch that is not there is an answer, not an error: it returns `{branch, exists: false}`, so this is the tool for checking before you create one. When the branch does exist it returns `branch`, `exists`, `sha` and `protected` -- the head commit's SHA, not the commit itself; use get_pr_diff or shell_execute git log for commit content. Does not mutate GitHub.", schema: GET_BRANCH_SCHEMA, handler: getBranch }),
  defineMcpTool({
    name: "sync_branch",
    description: "Synchronize the checked-out branch with its remote counterpart and report ahead/behind status. Use this after a non-fast-forward push failure or before retrying branch publication; it fast-forwards only when safe. It never rebases or force-pushes, and reports diverged branches for explicit resolution.",
    schema: SYNC_BRANCH_SCHEMA,
    handler: syncBranch,
  }),
  defineMcpTool({ name: "get_check_runs", description: "Retrieve GitHub Actions and other check runs for a commit, branch, or tag. Use this to verify CI status after pushing or before merge decisions. Returns one object per check with `name`, `status`, `conclusion` and `html_url` -- follow the URL for a failing check's log, which is not included. Does not wait for incomplete checks.", schema: GET_CHECK_RUNS_SCHEMA, handler: getCheckRuns }),
  defineMcpTool({
    name: "check_merge_readiness",
    description:
      "Report whether a pull request can be merged right now, and every reason it cannot. Read the `blockers` array rather than assuming a fixed set: kinds include failing, pending and absent required checks, merge conflicts, a branch behind its base, branch protection, draft state, a human author, a change under a governed path, a condition this project declared in `merge.gates`, and merge policy. Call this before github__merge_pr, and to explain a refused merge. When the only thing missing is a CI run on the head commit, this dispatches CI and says so — re-check afterwards rather than merging blind. Read-only apart from that dispatch.",
    schema: PR_CONTEXT_NUMBER_ARG_SCHEMA,
    handler: checkMergeReadiness,
  }),
  defineMcpTool({ name: "get_pr_reviews", description: "Retrieve submitted review summaries for one pull request. Use this to inspect review decisions and bodies; use list_pr_review_comments for line-level code comments. Returns { total, omitted, reviews } where each review has `author`, `state`, `submittedAt` and `body`; a non-zero `omitted` means the rest did not fit and you have not seen them all. Does not mutate GitHub.", schema: PR_CONTEXT_NUMBER_ARG_SCHEMA, handler: getPrReviews }),
  defineMcpTool({ name: "list_pr_review_comments", description: "Retrieve line-level review comments for one pull request. Use this to find file- and line-specific feedback; use get_pr_reviews for overall review decisions. Returns { total, omitted, comments } where each comment has `author`, `path`, `line`, `in_reply_to` and `body`; the surrounding code is not included, read it with filesystem or get_pr_diff, and a non-zero `omitted` means the rest did not fit. Does not mutate GitHub.", schema: PR_CONTEXT_NUMBER_ARG_SCHEMA, handler: listPrReviewComments }),
  defineMcpTool({
    name: "commit_and_push",
    description: "Stage all worktree changes, create one commit, and push the checked-out branch to origin. Use this after validation and before create_pr; do not call it with unrelated or unreviewed changes present. Returns JSON success status and fails rather than rewriting remote history.",
    schema: COMMIT_AND_PUSH_SCHEMA,
    handler: commitAndPush,
  }),
  defineMcpTool({
    name: "merge_pr",
    description: "Merge a pull request, then continue Atomaton's issue handoff. Refuses and returns merged:false with a `blockers` list whenever the PR is not mergeable. The list is open-ended, so read it rather than assuming a fixed set: it covers failing, pending and absent required checks, conflicts, a branch behind its base, branch protection, draft state, a human author, a change under a governed path, a condition this project declared in `merge.gates`, and merge policy. A refusal is a decision or a real defect, never a condition to retry around — read `blockers`, and use github__check_merge_readiness for detail. On success this may merge the PR, close its linked issue, and dispatch follow-up work.",
    schema: PR_NUMBER_ARG_SCHEMA,
    guidance: omittedNumberGuidance("pull request"),
    handler: mergePr,
  }),
]);

// The tools that hand back an issue, pull request, comment or review body: GitHub
// prose, carrying Atomaton's own state markers, which are not part of any answer an
// agent asked for. See `withoutBookkeeping`.
//
// `get_pr_diff` and `search_code` are deliberately absent. What they return is the
// text under review, where a tag-shaped literal is part of the change rather than a
// note about it -- `src/lib/lib.test.ts` holds one, and stripping it showed a
// reviewer a diff that was not the diff.
//
// `list_issues` and `list_prs` are absent because they return no body at all.
const dispatch = withoutBookkeeping(rawDispatch, [
  "get_issue",
  "get_issue_comments",
  "get_pr",
  "get_pr_reviews",
  "list_pr_review_comments",
]);

async function main(): Promise<void> {
  // Refused at startup, not per call.
  //
  // With `GITHUB_REPOSITORY` unset and a remote URL matching neither prefix,
  // `REPO` stays "" and every tool runs `gh … --repo ""`. Each one then fails
  // with a GitHub error about a malformed repository name, which reads as a
  // broken tool rather than a server that was never told which repository it is
  // for — and it reads that way once per call, for the whole run.
  //
  // `search.ts` already handles the same condition explicitly, and says exactly
  // this. Saying it once, before anything can be called, is the version that
  // costs nothing.
  if (!REPO) {
    log(
      "GITHUB_REPOSITORY is unset and no GitHub remote could be read, so there is no repository to act on. " +
        "Set GITHUB_REPOSITORY, or run where `git remote get-url origin` resolves to a github.com URL.",
    );
    process.exit(1);
  }
  log(`Starting for ${REPO}`);
  await serveMcpServer({ name: "atomaton-github-mcp", version: "1.0.0", tools: TOOLS, dispatch, log });
}

if (import.meta.main) void main();

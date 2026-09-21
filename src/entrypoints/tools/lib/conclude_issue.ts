import { gh } from "../../../adapters/github/gh.ts";
import { resolveNotify } from "../../../adapters/github/notify.ts";
import {
  describeGateResult,
  dispatchOrchestratorIfSubIssueReady,
  type DispatchGateResult,
} from "../../../app/aggregation.ts";
import { closeRequestComment } from "../../../domain/work/close-request.ts";
import type { GhIssueAuthor } from "../../../adapters/github/wire-types.ts";

export interface ConcludeIssueResult {
  /**
   * Whether this closed the issue or asked its author to.
   *
   * Both are conclusions, and the caller ends the session on either. The
   * distinction exists because the two leave the world differently — only a
   * closed issue wakes its parent — not because one of them failed. See
   * `domain/work/close-request.ts` for why the second is not a refusal.
   */
  outcome: "closed" | "close-requested";
  /**
   * What the parent's aggregation gate did afterwards, when this closed a
   * sub-issue.
   *
   * Carried out rather than discarded. `request_close_issue` ends the
   * orchestrator's session, so if the gate could not read what it needed and
   * refused to dispatch, nothing else is left to notice -- the parent simply
   * waits for a re-invocation that will never come.
   */
  aggregation?: DispatchGateResult;
}

/**
 * Throw unless a mutation actually happened.
 *
 * The author lookup below already checks its exit code, with a comment
 * explaining that picking an answer on a failed read "asserts something this did
 * not determine". Both mutations then ignored theirs entirely, which asserts
 * something rather worse: `request_close_issue` is the orchestrator's designated
 * terminal action, so it returns `outcome: "closed"`, tells the agent the issue
 * "has been closed automatically", and ends the session — after which nothing is
 * left running to notice that it is still open. `dispatchOrchestratorIfSubIssueReady`
 * then counts siblings against an issue that never closed.
 *
 * The close-requested half is the same shape, and worse now that it reports
 * success: a failed comment means the person named in it is never asked to close
 * anything, while the agent is told the issue is concluded and its session ends.
 *
 * Throwing reaches the agent as a tool error, which is the one moment it can
 * still act.
 */
function mustSucceed(result: { code: number; stdout: string; stderr: string }, what: string): void {
  if (result.code === 0) return;
  throw new Error(`Could not ${what}: ${result.stderr.trim() || result.stdout.trim() || `gh exited ${result.code}`}`);
}

/**
 * Concludes the issue: closes an agent-opened one, asks the author to close a
 * person-opened one.
 *
 * Neither branch fails, and the caller ends the session on both. Who opened the
 * issue is this function's question to ask, not its caller's to handle — see
 * `domain/work/close-request.ts` for the reports that came out of answering it
 * the other way.
 */
export async function concludeIssue(issue: number, reason: string, summary: string): Promise<ConcludeIssueResult> {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  // The exit code decides, not just the presence of output. An unread author is
  // not a human author: closing the issue outright and telling a person "this was
  // opened directly by a human" are different acts, and picking either one on a
  // failed lookup asserts something this did not determine. The same question is
  // asked fail-loud in `mcp/github.ts` via `ghJsonOrThrow`.
  const { code, stdout } = gh("issue", "view", String(issue), "--repo", repo, "--json", "author");
  if (code !== 0) {
    throw new Error(
      `Could not read the author of issue #${issue}, so this cannot tell whether closing it is yours to do.`,
    );
  }
  const authorInfo = stdout ? (JSON.parse(stdout) as GhIssueAuthor) : {};
  // Absent field still means "treat as a person", which is the cautious half of
  // the pair: it hands the decision to someone rather than taking it.
  const isBot = authorInfo.author?.is_bot ?? false;

  let body = `Atomaton: orchestrator considers work on this issue complete.\n\n**Reason:** ${reason}`;
  if (summary) {
    body += `\n\n${summary}`;
  }

  if (!isBot) {
    // The request goes above the reason and summary, not after them. It is the
    // only sentence in the comment addressed to the person reading it.
    body = closeRequestComment({ notify: resolveNotify(repo, issue), body });
    mustSucceed(gh("issue", "comment", String(issue), "--repo", repo, "--body", body), `comment on issue #${issue}`);
    // stderr, where the tool's own decisions belong. Putting it in the result is
    // what put it in the agent's report.
    console.error(`close requested: issue=#${issue} (opened by a person, left open for them)`);
    return { outcome: "close-requested" };
  }

  mustSucceed(gh("issue", "comment", String(issue), "--repo", repo, "--body", body), `comment on issue #${issue}`);
  mustSucceed(gh("issue", "close", String(issue), "--repo", repo), `close issue #${issue}`);
  console.error(`closed: issue=#${issue} (bot-authored)`);
  const aggregation = await dispatchOrchestratorIfSubIssueReady(repo, issue);
  console.error(describeGateResult(aggregation, issue));
  return { outcome: "closed", aggregation };
}
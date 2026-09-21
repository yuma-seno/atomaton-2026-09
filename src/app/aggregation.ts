/**
 * aggregation.ts — the ONE canonical implementation of "check whether all
 * sub-issues of an orchestrated parent are done, and if so, dispatch the
 * orchestrator for re-invocation".
 *
 * Three call sites need this exact gate, previously reimplemented
 * independently with subtly different retry/exclude/idempotency behavior:
 *
 * - `dispatchOrchestratorIfSubIssueReady` below, reached from the MCP server
 *   whenever an agent closes a sub-issue (atomaton-side, post-close).
 * - dispatch_if_siblings_done.ts (workflow-side, manual-close fallback).
 * - aggregate_sub_issues.ts (workflow-side, PR-merge primary path -- which
 *   additionally injects sub-issue results into the orchestrator's session
 *   before dispatching, via `beforeDispatch` below).
 *
 * Idempotency: two of the three can race for the SAME completion -- a PR merge
 * triggers the event-driven aggregate_sub_issues.ts AND, asynchronously, an
 * origin-agent re-invocation that eventually closes the sub-issue itself and
 * reaches the first path. The `atomaton:aggregated` marker check below makes
 * whichever caller gets here first win and the other a no-op.
 */
import { gh } from "../adapters/github/gh.ts";
import { countOpenSiblings } from "../adapters/github/sibling-check.ts";
import { dispatchRunner } from "../adapters/actions/dispatch.ts";
import { resolveNotify } from "../adapters/github/notify.ts";
import { AGGREGATED_TAG, LLM_CONTEXT_TAG, SUB_RESULT_TAG } from "../adapters/github/tags.ts";
import { parentIssueOf } from "../adapters/github/parent-issue.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatchGateOptions {
  repo: string;
  parent: number;
  /** The sub-issue whose completion triggered this check. */
  closedNum: number;
  /**
   * Retry the sibling count with backoff (4 attempts), for the lag between
   * closing an issue and GitHub reporting it closed -- needed when called right
   * after OUR OWN close of `closedNum`.
   */
  retry?: boolean;
  /**
   * Exclude `closedNum` from the sibling count regardless of its live
   * open/closed state -- needed when called from a PR-merge event, where
   * `closedNum` may not be reflected as closed yet at all (native
   * "Closes #N" auto-close is unreliable under the Actions GITHUB_TOKEN).
   */
  exclude?: boolean;
  /** Progress-comment text posted when siblings remain. Omit to post nothing in that case (matches the manual-close fallback's original silent behavior). */
  progressMessage?: (remaining: number) => string;
  /** Run just before posting the "all done" comment + dispatching -- aggregate_sub_issues.ts uses this to inject sub-issue results into the orchestrator's persisted session first. */
  beforeDispatch?: () => Promise<void> | void;
}

/**
 * What the gate did, as one of seven distinguishable answers.
 *
 * It used to be `{ready, remaining, dispatched}`, in which
 * `{ready: true, dispatched: false}` meant four different things: another
 * caller won the race (benign), the comment read failed so the gate refused to
 * decide, the dispatch failed, or -- once the write below started being checked
 * -- the marker write failed. Only some of those leave work undone.
 *
 * Both callers knew, and papered over it with the same duplicated sentence:
 * "another caller already handled this completion, or the dispatch failed --
 * check for a WARN above." Both were already out of date, naming two causes
 * where there were three. A hedge repeated verbatim in two files is the tell
 * that the return type cannot say what happened.
 */
export type DispatchGateResult =
  /** Not this issue's business: GitHub has it under nothing. */
  | { kind: "not-tracked" }
  /** Siblings are still open. `remaining` is how many. */
  | { kind: "waiting"; remaining: number }
  /** Another caller reached this completion first. The normal race, and harmless. */
  | { kind: "already-aggregated" }
  /** The orchestrator is running. */
  | { kind: "dispatched" }
  /** Everything was ready and the dispatch itself failed. Nothing will retry. */
  | { kind: "dispatch-failed" }
  /**
   * Everything was ready and the parent is closed, so no orchestrator was started.
   *
   * Distinct from `dispatch-failed` because nothing malfunctioned: somebody closed the
   * parent while its children were finishing. Work is still left undone, so this needs
   * a person as much as a failure does -- and `dispatchRunner` has already told the one
   * who asked for the run, which is why this kind carries no `why`.
   */
  | { kind: "parent-closed" }
  /**
   * Something could not be read or written, so the gate refused to decide.
   *
   * Distinct from every answer above, because the safe move here is to do
   * nothing and say so -- and a caller that cannot tell this from
   * `already-aggregated` reports a benign race when work has actually stalled.
   */
  | { kind: "undetermined"; why: string };

/** True when the orchestrator was not started and something is left undone. */
export function needsAttention(result: DispatchGateResult): boolean {
  return result.kind === "dispatch-failed" || result.kind === "undetermined" || result.kind === "parent-closed";
}

/**
 * The one sentence a gate result deserves in a run log.
 *
 * Both callers used to print the same hedge -- "another caller already handled
 * this completion, or the dispatch failed" -- because the old return type could
 * not tell those apart. It listed two causes where there were three, in two
 * files, and neither noticed. A sentence duplicated verbatim across call sites
 * is a return type asking to be a union.
 */
export function describeGateResult(result: DispatchGateResult, closedNum: number, parent?: number): string {
  // `parent` is optional because one caller does not know it: `close_issue`
  // reaches the gate through the sub-issue's own link. Named as "the parent"
  // there rather than printed as `#0`, which would be a number that identifies
  // a different thing.
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
      return (
        `All sub-tasks of ${which} complete, but the orchestrator dispatch FAILED. ` +
        `The aggregation marker is already written, so no other caller will retry: ` +
        `re-run the orchestrator by hand.`
      );
    case "parent-closed":
      return (
        `All sub-tasks of ${which} complete, but ${which} is closed, so no orchestrator was started. ` +
        `The aggregation marker is already written, so no other caller will retry: ` +
        `reopen it and run the orchestrator by hand. Whoever asked for the run has been told on the issue.`
      );
    case "undetermined":
      return `Did not aggregate #${closedNum}: ${result.why}. Nothing was dispatched, and nothing will retry.`;
  }
}
export async function dispatchOrchestratorIfReady(opts: DispatchGateOptions): Promise<DispatchGateResult> {
  const excludeNum = opts.exclude ? opts.closedNum : undefined;
  const count = () => countOpenSiblings({ repo: opts.repo, parent: opts.parent, exclude: excludeNum });

  // `countOpenSiblings` throws when the sub-issue links could not be read, while every other
  // failure in this module is a return value. That exception used to escape the
  // gate entirely, and the two call sites were inconsistent about it -- one
  // wrapped the whole thing in try/catch and the other did not, which is not a
  // policy, it is one of them having remembered. Caught here so the gate has one
  // way of saying "could not tell".
  let remaining: number;
  try {
    remaining = count();
    if (opts.retry) {
      for (let attempt = 1; remaining > 0 && attempt < 4; attempt++) {
        await sleep(2000 * attempt);
        remaining = count();
      }
    }
  } catch (error) {
    const why = `could not count #${opts.parent}'s open sub-issues: ${(error as Error).message}`;
    console.error(why);
    return { kind: "undetermined", why };
  }

  if (remaining > 0) {
    if (opts.progressMessage) {
      gh(
        "issue", "comment", String(opts.parent), "--repo", opts.repo,
        "--body", `${LLM_CONTEXT_TAG.write("exclude")}\n${SUB_RESULT_TAG.write(opts.closedNum)}\n${opts.progressMessage(remaining)}`,
      );
    }
    return { kind: "waiting", remaining };
  }

  // The exit code matters here: this read IS the idempotency check. A failed one
  // returns no comments, the marker is not found, and both racing callers then
  // decide they are the first — which is the one thing the marker exists to
  // prevent. Not finding the marker and not being able to look are different
  // answers, and only one of them means "go ahead".
  const { code: commentsCode, stdout: commentsOut } = gh(
    "issue", "view", String(opts.parent), "--repo", opts.repo,
    "--json", "comments", "--jq", ".comments[].body",
  );
  if (commentsCode !== 0) {
    const why = `could not read #${opts.parent}'s comments, so this cannot tell whether the aggregation already ran`;
    console.error(`${why}; not dispatching`);
    return { kind: "undetermined", why };
  }
  if (commentsOut.includes(AGGREGATED_TAG.write(opts.closedNum))) {
    // Another caller already handled this exact completion (see module doc
    // comment for the race this guards against).
    return { kind: "already-aggregated" };
  }

  if (opts.beforeDispatch) await opts.beforeDispatch();

  // The exit code matters here too, and used to be discarded.
  //
  // The read above is guarded, with five lines explaining why: not finding the
  // marker and not being able to look are different answers. The same argument
  // applies to writing it, and was not applied. A rate limit or a transient 5xx
  // on this one comment leaves no marker -- and the other racer, which by
  // construction is running at this same moment, then finds none, decides it is
  // first, and dispatches the orchestrator a second time. Two runs aggregate the
  // same completion, post two final reports, and hold the in-progress guard with
  // two `chain_continues` signals.
  //
  // A missed aggregation is recoverable by the other racer. A double dispatch is
  // not, and that asymmetry is exactly what the read already relies on.
  const marker = gh(
    "issue", "comment", String(opts.parent), "--repo", opts.repo,
    "--body", `${AGGREGATED_TAG.write(opts.closedNum)}\nAtomaton: All sub-tasks completed (last: #${opts.closedNum}). Re-invoking orchestrator for aggregation.`,
  );
  if (marker.code !== 0) {
    const why =
      `could not write the aggregation marker on #${opts.parent}: ${marker.stderr.trim() || marker.stdout.trim()}`;
    console.error(`${why}; not dispatching, because without the marker a second caller would dispatch too`);
    return { kind: "undetermined", why };
  }

  const outcome = dispatchRunner({
    context: `all sub-issues of #${opts.parent} are complete, so its orchestrator was to be re-invoked`,
    agent: "orchestrator",
    type: "issue",
    number: opts.parent,
    notify: resolveNotify(opts.repo, opts.parent),
    repo: opts.repo,
  });

  // Reported rather than assumed. The `atomaton:aggregated` marker above is already
  // written at this point, so a failed dispatch cannot be retried by the racing
  // caller either -- saying so is the only way it reaches a human.
  if (outcome === "dispatched") return { kind: "dispatched" };
  // A closed parent is not a fault, and the person who asked for the run has already
  // been told by `dispatchRunner` itself. Kept apart from `dispatch-failed` so this
  // does not read in the log as GitHub having rejected something.
  return outcome === "refused-closed" ? { kind: "parent-closed" } : { kind: "dispatch-failed" };
}

/**
 * Resolves `subIssueNum`'s orchestrator parent from GitHub's own sub-issue link,
 * then runs the dispatch gate on it with retry enabled (the sub-issue we just closed
 * a moment ago may still be reported as open for a second or two).
 * Returns `not-tracked` when `subIssueNum` is under nothing (not every closed issue
 * is a tracked Atomaton sub-issue), and `undetermined` when its parent could not be
 * read -- which is a different thing, because an unread one may belong to a sub-issue
 * that just completed.
 *
 * The one canonical "a sub-issue just closed -- is its parent ready?"
 * entry point, used identically by mcp/github.ts's closeIssueAndDispatch() and
 * concludeIssue's bot-authored-issue branch (previously both
 * spawned the now-removed dispatch_orchestrator_if_ready.ts script).
 *
 * Both callers reach it only on a close that actually happened. An issue whose
 * author was merely asked to close it is still open, and asking this about it
 * would be asking whether every sibling is closed while holding one that is not.
 */
export async function dispatchOrchestratorIfSubIssueReady(repo: string, subIssueNum: number): Promise<DispatchGateResult> {
  // `adapters/github/parent-issue.ts`, the same reader `countOpenSiblings` now agrees with.
  //
  // This used to insist on the `atomaton:parent` tag alone and said why: the sibling
  // count was a search for `atomaton:parent=N in:body`, so a parent found through
  // GitHub's native link would have had no countable siblings and the gate would have
  // concluded "all done" on the strength of a search that could never have found any.
  // Two halves that had to agree about what a sibling is, agreeing by both being
  // wrong in the same way. Both halves read the link now, so the constraint is met by
  // the answer being one answer rather than by neither half looking.
  const found = parentIssueOf(repo, subIssueNum);
  // A parent that could not be READ is not an issue without one. Reported as itself,
  // because the two lead to opposite places: no parent means this issue is untracked
  // and there is nothing to do, while an unread one means a tracked sub-issue may
  // have just completed and the orchestrator is never told.
  if (!found.known) {
    const why = `could not read the parent of #${subIssueNum}: ${found.why}`;
    console.error(why);
    return { kind: "undetermined", why };
  }
  if (!found.parent) {
    console.error(`issue #${subIssueNum} is not a sub-issue of anything, nothing to do`);
    return { kind: "not-tracked" };
  }
  return dispatchOrchestratorIfReady({ repo, parent: found.parent, closedNum: subIssueNum, retry: true });
}

/**
 * completion-mention.ts — decides whether a finished run should pull a person in.
 *
 * The mention on a result comment means one thing: nothing else is going to
 * happen unless you do something. It is the only signal a person gets that work
 * has stopped, so it has to fire whenever work really has stopped — and stay
 * quiet whenever it has not, or it trains people to ignore it.
 *
 * Pure: the caller reads the run's outcome and the issue's state, this decides.
 */

export interface CompletionSignals {
  /** The agent's closing directive line, if it named another agent to run next. */
  directive?: string;
  /** A tool call during this run already dispatched a follow-up run. */
  chainContinues: boolean;
  /** The login to mention, empty when nobody is configured. */
  notify?: string;
  /** This issue was created by an agent as part of a larger one's plan. */
  isSubIssue: boolean;
  /** The issue is closed as of this comment. */
  issueClosed: boolean;
  /**
   * A person asked this run to stop, or it ran out of iterations.
   *
   * Either one cancels the directive's dispatch -- `DISPATCH_NEXT_GUARD` in
   * `atomaton-runner.wac.ts` refuses on both -- so the directive below stops being
   * evidence that anything will follow. Without these, a run that stopped on the
   * same turn it named its successor went quiet twice over: the successor did not
   * start, and nobody was told, because the comment believed the handoff it could
   * see rather than the stop it could not.
   */
  stopRequested?: boolean;
  limitReached?: boolean;
}

/**
 * Whether to append the "no agent will run next" mention.
 *
 * Three ways work continues without a person, and each silences the mention:
 *
 * - The agent handed off, naming the next agent in its directive.
 * - A tool call already dispatched the next run — `create_pr` starting the
 *   reviewer, `launch_sub_agent` starting the children.
 * - A closed sub-issue. Closing one is what wakes its parent: the aggregation
 *   gate re-invokes the parent's orchestrator once the last sibling lands, and
 *   until then the parent is what is waiting, not a person. The dispatch happens
 *   in a later workflow run, so `chainContinues` — which only sees this run —
 *   cannot know about it.
 *
 * A sub-issue that is still OPEN is deliberately not in that list. Nothing wakes
 * a parent for a sub-issue that has not finished, so a run that ends there has
 * genuinely stopped, and that is exactly the case a person needs to hear about.
 *
 * The directive is the one of the three that can be contradicted. A stop or a
 * spent iteration budget means the run it named never started, so the handoff is a
 * plan rather than a fact and silences nothing. The other two are not: a tool that
 * already dispatched has already dispatched, and a closed sub-issue still wakes its
 * parent, whether or not the run that closed it was stopped afterwards.
 */
export function shouldMentionOnCompletion(signals: CompletionSignals): boolean {
  if (!signals.notify) return false;
  const handoffWillRun = !signals.stopRequested && !signals.limitReached;
  if (signals.directive && handoffWillRun) return false;
  if (signals.chainContinues) return false;
  if (signals.isSubIssue && signals.issueClosed) return false;
  return true;
}

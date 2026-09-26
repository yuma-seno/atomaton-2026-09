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
import type { TurnEnding } from "./turn.ts";

export interface CompletionSignals {
  /**
   * How this turn ended, and who it named.
   *
   * It was the raw directive plus `stopRequested` and `limitReached`, and this
   * function re-derived "will the hand-off actually run" from the three — the
   * fourth place in the system deriving a turn's ending for itself. It is read
   * from `domain/work/turn.ts` now, which is where the derivation lives.
   */
  ending: TurnEnding;
  /**
   * A tool call during this run already dispatched a follow-up run.
   *
   * Beside the ending rather than inside it, because it is a fact about what
   * already happened rather than about how this turn finished. A `create_pr` that
   * started the reviewer started it; a stop arriving afterwards does not unstart it.
   */
  chainContinues: boolean;
  /** The login to mention, empty when nobody is configured. */
  notify?: string;
  /** This issue was created by an agent as part of a larger one's plan. */
  isSubIssue: boolean;
  /** The issue is closed as of this comment. */
  issueClosed: boolean;
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
 *   gate re-invokes the parent's atomaton once the last sibling lands, and
 *   until then the parent is what is waiting, not a person. The dispatch happens
 *   in a later workflow run, so `chainContinues` — which only sees this run —
 *   cannot know about it.
 *
 * A sub-issue that is still OPEN is deliberately not in that list. Nothing wakes
 * a parent for a sub-issue that has not finished, so a run that ends there has
 * genuinely stopped, and that is exactly the case a person needs to hear about.
 *
 * The hand-off is the one of the three that can be contradicted, and the ending is
 * what already knows: a turn that was stopped, spent, or that failed outright
 * carries no `next` at all, so the plan it wrote silences nothing. The other two
 * are not contradictable — a tool that already dispatched has already dispatched,
 * and a closed sub-issue still wakes its parent, whether or not the run that closed
 * it was stopped afterwards.
 *
 * `chain-over` carries a `next` and silences, which looks like an exception and is
 * not: the chain's own limit posts a comment naming that agent and mentioning the
 * same person. Silencing here is what keeps one event to one notification.
 *
 * ## The one ending that outranks the silencers
 *
 * `no-report` — a run that ended of its own accord having said nothing — is told
 * about whatever else is true, and the only silencer it can actually meet is the
 * closed sub-issue. (It cannot carry a `next`, and a `chainContinues` run is
 * `handed-off` before it ever gets here.)
 *
 * Overriding that one is the point rather than an oversight. The sub-issue rule says
 * the parent is what is waiting, not a person — and that holds because the parent's
 * atomaton is woken to aggregate what its children found. A child that wrote
 * nothing hands it nothing to aggregate, and the one thing the parent cannot do is
 * go and find out what happened: the work is in a saved session, where no agent
 * looks. So the premise of the silence fails exactly here, and the notification is
 * the only thing left that reaches somebody who can read the session.
 *
 * Measured: three of 396 sessions ended this way with the core recording
 * `completed`, after 313, 173 and 110 tool calls. Each was, until now, a success
 * nobody was told about.
 */
export function shouldMentionOnCompletion(signals: CompletionSignals): boolean {
  if (!signals.notify) return false;
  if (signals.ending.ended === "no-report") return true;
  if (signals.ending.next) return false;
  if (signals.chainContinues) return false;
  if (signals.isSubIssue && signals.issueClosed) return false;
  return true;
}

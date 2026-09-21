/**
 * closed-issue.ts — what happens when work meets an issue or pull request that is closed.
 *
 * Three paths used to walk straight past a closed target, and all three did it
 * silently: a person closing an issue did not stop the run working on it, a slash
 * command on a closed issue started an agent, and the machinery's own handoff
 * dispatched onto a closed number. The last one is not hypothetical — #803 was closed
 * by hand and eighteen seconds later the aggregation gate re-invoked its orchestrator,
 * which went on to open a pull request. See #827.
 *
 * The rule this module encodes is one sentence: **a closed target is an answer, not an
 * obstacle.** Nothing here reopens anything, because closing is a person's decision and
 * a machine that undoes it is arguing rather than reporting. What each path does
 * instead is refuse, and say what will not happen now — which is the part that was
 * missing, not the refusal.
 *
 * Pure: callers read the state from GitHub, these decide and write the words.
 */
import type { NodeKind, NodeState } from "./work-tree.ts";

/**
 * A dispatch target's state as far as this is concerned.
 *
 * "Nobody could read it" is deliberately its own case rather than being folded into
 * `open`. A lookup that failed is not evidence that the issue is open, and treating
 * it as such would make every guard here fail in the direction that lets work
 * through — the failure this repository keeps finding.
 * `guard_comment_during_run.ts` already refuses the same way for the same reason.
 *
 * It is `known: false` rather than a third `kind`, because it answers a different
 * question. `kind` and `state` say what the target IS; this says whether anybody
 * found out. Putting them in one enum is what let `state.kind === "unknown"` sit in
 * the same expression as `state.kind === "closed"` as though they were alternatives
 * of one thing.
 */
export type TargetState =
  | { known: true; kind: NodeKind; state: NodeState }
  | { known: false; why: string };

/**
 * Whether work may be started on a target in this state. Only an open one qualifies.
 *
 * A target nobody could read does not qualify either, and that is what `known`
 * separates: the answer to "is it open" and the answer to "could anyone tell" are
 * different, and only one of them is safe to guess.
 */
export function mayStartWorkOn(target: TargetState): boolean {
  return target.known && target.state === "open";
}

/**
 * Whether a person could put this target back where work can run.
 *
 * Merging is the one ending GitHub makes final. Everything else that ended —
 * an issue completed or dropped, a pull request closed without merging — reopens.
 *
 * Derived rather than stored. This used to be a `merged: boolean` carried beside a
 * `closed` case, which was the third place in this repository spelling the same
 * fact its own way: `NodeState` says a pull request that is `done` is one that
 * merged, and `kind` is already here.
 */
export function canBeReopened(target: TargetState): boolean {
  return target.known && !(target.kind === "pull-request" && target.state === "done");
}

/**
 * How a person gets this target back into a state where work can run.
 *
 * A merged pull request is the case worth spelling out: GitHub offers no way to reopen
 * one, so "reopen it" is advice that cannot be followed, and a notice that gave it
 * would read as the machinery not knowing what it was looking at.
 */
export function recoveryAdvice(state: TargetState, number: number, command: string): string {
  if (state.known && !canBeReopened(state)) {
    return (
      `#${number} is merged, and GitHub cannot reopen a merged pull request. ` +
      `Open an issue for the follow-up instead.`
    );
  }
  return `Reopen #${number} and comment \`${command}\` to run it.`;
}

function mentionPrefix(logins: readonly string[]): string {
  return logins.length > 0 ? `${logins.map((l) => `@${l}`).join(" ")} ` : "";
}

/**
 * The receipt a person reads after closing an issue a run was working on.
 *
 * A receipt, and deliberately not a record. Two things speak about one close: this,
 * from the workflow the close triggered, and the run's own result comment ten to
 * thirty seconds later. They used to say the same thing twice, mention the same
 * person twice, and one of them was lying: this claimed "the session is saved" when
 * the run that saves it had not stopped yet.
 *
 * So each says only what it actually knows when it speaks. This one knows the close
 * happened, that a run holds the issue, and that a stop has been asked for. It does
 * not know whether the run stops, whether the session survives, or that `/resume`
 * will work — the run knows those, and says them.
 *
 * No mention, for the same reason. A mention means "your turn"; the person who just
 * closed the issue has taken theirs, and what they have to do now is wait. The turn
 * comes back to them when the run reports, and that comment mentions them.
 */
export function stopOnCloseNotice(number: number): string {
  return [
    "Atomaton: this issue was closed while an agent was working on it, so the run has been asked to stop.",
    "",
    "Closing does not stop a run by itself — it kept going until this request reached it. The run stops after its current step, so it may take a minute.",
    "",
    `#${number} stays closed, and the run will report here when it has stopped.`,
  ].join("\n");
}

/**
 * What a person reads after closing an issue that had work under it.
 *
 * Closing is the end of a line of work, not of one node — see `domain/work/work-tree.ts`.
 * So the sub-issues and pull requests below go with it, and this says which, because a
 * close that quietly reached further than the person looked is the kind they find out
 * about later.
 *
 * `closed` and `stopped` are listed apart because they are different claims. A node
 * was closed; a run on it was asked to stop, which takes a moment longer and is the
 * part that is not done yet when this is posted.
 */
export function closedTheTreeNotice(closed: readonly number[], stopped: readonly number[]): string {
  const lines: string[] = [];
  if (closed.length > 0) {
    lines.push(
      "",
      `The work under it is closed too: ${closed.map((n) => `#${n}`).join(", ")}.`,
    );
  }
  if (stopped.length > 0) {
    lines.push(
      "",
      `Runs were going on ${stopped.map((n) => `#${n}`).join(", ")}, and each has been asked to stop.`,
    );
  }
  return lines.join("\n");
}

/**
 * The reply to a slash command on a closed issue or pull request.
 *
 * The comment itself is left alone, unlike the in-progress guard, which deletes. That
 * guard deletes because the comment it caught would otherwise race a running agent and
 * end up in its context. Nothing is running here and nothing is racing, so removing
 * somebody's words would cost something and buy nothing.
 */
export function commandOnClosedNotice(
  commenter: string,
  command: string,
  state: TargetState,
  number: number,
): string {
  const what = !state.known
    ? `Atomaton: \`${command}\` was not run, because the state of #${number} could not be read (${state.why}), and a command is not started on a target that might be closed.`
    : `Atomaton: \`${command}\` was not run, because #${number} is closed.`;
  return [
    `${mentionPrefix(commenter ? [commenter] : [])}${what}`,
    "",
    !state.known
      ? "Comment again once it can be read."
      : recoveryAdvice(state, number, command),
  ].join("\n");
}

/** Everything the escalation below needs, gathered by the caller that was dispatching. */
export interface RefusedDispatch {
  agent: string;
  number: number;
  /** Why the dispatch was happening, in the words the dispatching caller used. */
  context: string;
  state: TargetState;
  /** Who asked for this run, resolved by the chain that carries the login onward. */
  notify: string;
}

/**
 * The escalation posted when the machinery declines to dispatch onto a closed target.
 *
 * Written for whoever gets the mention rather than for a log, because the person
 * reading it did not ask for a dispatch and does not care that one was refused. What
 * they need is the thing that is now not going to happen, and what to do about it —
 * "the dispatch was rejected" is the machine's account of the same event and tells
 * them neither.
 *
 * Nothing retries after this. That is stated outright: a notice that leaves it open
 * whether something else will pick the work up is one people wait on.
 */
export function dispatchRefusedNotice(refused: RefusedDispatch): string {
  const { agent, number, context, state, notify } = refused;
  const why = !state.known
    ? `the state of #${number} could not be read (${state.why})`
    : `#${number} is closed`;
  return [
    `${mentionPrefix(notify ? [notify] : [])}Atomaton: \`${agent}\` was not started on #${number}, because ${why}.`,
    "",
    `What was about to happen: ${context}.`,
    "",
    "Nothing will retry this.",
    "",
    !state.known
      ? `Start it by hand once #${number} can be read: comment \`/${agent}\` on it.`
      : recoveryAdvice(state, number, `/${agent}`),
  ].join("\n");
}

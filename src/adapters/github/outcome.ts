/**
 * outcome.ts — how GitHub spells the end of a piece of work, read into the one
 * word the domain uses for it.
 *
 * `domain/work/work-tree.ts` says a node is `open`, `done` or `abandoned`. GitHub
 * says it four different ways depending on what is being asked and which API is
 * answering: an issue carries `state` plus a `state_reason`, a pull request
 * carries `state` plus whether it merged, REST shouts in snake case and GraphQL in
 * upper. Every one of those is this module's business and none of it is the
 * domain's.
 *
 * Here rather than beside either reader because both of them need it.
 * `work-tree.ts` builds nodes three ways and `issue-links.ts` a fourth, and the
 * previous arrangement — each spelling its own conditional — is how
 * `state === "OPEN" ? ... : state === "MERGED" ? ...` came to exist in one of them
 * and `state === "open" ? ... : ...` in the next, agreeing only by luck.
 */
import type { NodeState } from "../../domain/work/work-tree.ts";

/**
 * How a closed ISSUE ended, from the reason GitHub records against the close.
 *
 * `completed` and `not_planned` are the two a person picks in the UI; `duplicate`
 * was added later and means the work moved somewhere else, which is still not
 * landing here.
 *
 * Anything unrecognised, and an absent reason, read as `done`. That is GitHub's
 * own default for a close with nothing said, and the alternative is worse in a way
 * that is easy to miss: reading a silent close as abandonment would relabel every
 * issue finished before the field existed.
 *
 * Case-folded because REST answers `not_planned` and GraphQL answers `NOT_PLANNED`
 * for the same fact, and both reach this.
 */
export function issueOutcome(reason: string | null | undefined): NodeState {
  const said = (reason ?? "").toLowerCase();
  return said === "not_planned" || said === "duplicate" ? "abandoned" : "done";
}

/**
 * How a closed PULL REQUEST ended. It merged, or it did not; there is no reason
 * field and none is needed.
 */
export function pullRequestOutcome(merged: boolean): NodeState {
  return merged ? "done" : "abandoned";
}

/** `true` when GitHub's `state` field, in either case and either API, means open. */
export function saysOpen(state: string | null | undefined): boolean {
  return (state ?? "").toLowerCase() === "open";
}

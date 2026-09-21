/**
 * turn.ts — how one agent's attempt on one node ended, and what follows from it.
 *
 * A **turn** is one agent advancing one node: the unit the rest of this domain is
 * written in terms of, and until this module the one it could not name. Its ending
 * existed as six loose signals that three different places each derived their own
 * answer from — one of them in GitHub Actions expression syntax, where nothing
 * could test it.
 *
 * ## What this replaces
 *
 * `domain/work/serialization-guard.ts` held one of those answers, and its header
 * recorded the same defect one level down: before it existed, the rule was
 * "a string-concatenated GitHub Actions `if:` expression inside
 * atomaton-runner.wac.ts (`REMOVE_LABEL_GUARD`) -- untestable, unnamed, and only
 * readable by parsing bash-adjacent expression syntax."
 *
 * That was fixed for the guard and not for its neighbour. `DISPATCH_NEXT_GUARD`
 * stood thirty lines below the step that asked the domain, deciding *does the chain
 * continue* from four of the same six signals, as an expression — and
 * `docs/operations.md` forbids exactly that, in a paragraph the expression sat
 * beside.
 *
 * So the signals are read once, into a name, and every question is asked of the
 * name.
 *
 * ## Why these six endings
 *
 * Each is a different sentence a person says about a run that has stopped, and that
 * is the test applied: not "which flags were set" but "what would you tell somebody
 * who asked what happened".
 *
 * `control-commands.ts` argued the hard part already — a stop is not a state of its
 * own, because "a stopped run has ended and handed back to a person, which is the
 * same terminal state as an agent that finished its turn, ran out of time, or hit
 * the handoff limit". Same terminal state, different sentences; they are told apart
 * here and treated alike by the guard, which is what that argument asks for.
 */

/** Who a turn named to run next. Always on the same node: a directive hands the node over, it does not move the work. */
export interface NextTurn {
  readonly agent: string;
}

/**
 * How a turn ended.
 *
 * `spent` and `chain-over` are two different ceilings and are named apart because a
 * person goes and looks at different things: the first is this run reaching the
 * limit set on it, the second is a chain of runs going on too long without getting
 * anywhere. They were one `if:` condition away from being reported as each other.
 */
export type Ending =
  /** The run itself did not complete. Nothing below it is known. */
  | "failed"
  /** A person asked it to stop, and it did. */
  | "stopped"
  /** It reached the limit set on this run. */
  | "spent"
  /** The chain of runs reached ITS limit, so a named hand-off is refused rather than taken. */
  | "chain-over"
  /** Work continues: it named the next agent, or a tool call already started one. */
  | "handed-off"
  /** It is done and nothing follows. */
  | "finished";

export interface TurnEnding {
  readonly ended: Ending;
  /**
   * Who it named, when it named anybody.
   *
   * Present on `handed-off`, where it is dispatched, and on `chain-over`, where it
   * is not — the name is what the notice tells a person was about to happen. Absent
   * on a hand-off that a tool call already started, which needs no dispatch because
   * the run is already going.
   */
  readonly next?: NextTurn;
}

/** The raw signals a finished run leaves behind, as the workflow reads them. */
export interface TurnSignals {
  /** Did the agent step complete, as opposed to crashing or being skipped? */
  succeeded: boolean;
  /** This run reached the limit set on it. */
  limitReached: boolean;
  /** A person asked this run to stop. */
  stopRequested: boolean;
  /** The cross-run chain reached its own limit. */
  loopLimitReached: boolean;
  /** A tool call already started a follow-up run during this turn. */
  chainContinues: boolean;
  /** The agent's closing line naming who goes next, or empty. */
  directive: string;
}

/**
 * Read the signals into the one name.
 *
 * The order is the precedence, and it reads downward from "we know least" to "we
 * know most": a run that did not complete tells us nothing about what it intended,
 * so nothing below it is consulted.
 *
 * `stopped` and `spent` cannot both hold. The core exits the same way for both and
 * the workflow tells them apart by whether a stop file is there, so exactly one
 * arrives set — they are ordered for reading rather than to resolve a conflict.
 */
export function endingOf(signals: TurnSignals): TurnEnding {
  const named = signals.directive.trim();
  const next = named === "" ? undefined : { agent: named };

  if (!signals.succeeded) return { ended: "failed" };
  if (signals.stopRequested) return { ended: "stopped" };
  if (signals.limitReached) return { ended: "spent" };
  if (signals.loopLimitReached) return { ended: "chain-over", ...(next ? { next } : {}) };
  if (next || signals.chainContinues) return { ended: "handed-off", ...(next ? { next } : {}) };
  return { ended: "finished" };
}

/**
 * Whether the at-most-one-turn-per-node guard should be released.
 *
 * One ending holds it: work is still actively going, possibly on a different node
 * entirely, under this one. Every other ending has handed back — to a person, or to
 * nobody — and a node nothing is working on must not stay locked.
 *
 * The mechanism that enacts this is the `atomaton/in-progress` label, in
 * `entrypoints/machinery/manage_in_progress_label.ts`. It is deliberately not named
 * here: the rule is about turns and the label is one way to persist it.
 */
export function shouldReleaseGuard(ending: TurnEnding): boolean {
  return ending.ended !== "handed-off";
}

/** Who to start now, when this turn handed off to somebody and the chain may continue. */
export function nextToDispatch(ending: TurnEnding): NextTurn | undefined {
  return ending.ended === "handed-off" ? ending.next : undefined;
}

/**
 * Who this turn named, when the chain's own limit is what stops them running.
 *
 * Separate from `nextToDispatch` because the two are what a person reads the
 * difference between: one is a hand-off that happened, the other is a hand-off that
 * was refused and is now somebody's to take by hand.
 */
export function refusedByChainLimit(ending: TurnEnding): NextTurn | undefined {
  return ending.ended === "chain-over" ? ending.next : undefined;
}

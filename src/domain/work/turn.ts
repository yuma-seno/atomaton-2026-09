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
 * ## Why these seven endings
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
 *
 * `no-report` and `finished` are the same split one level further in. `finished` used
 * to be the bottom of this list in the sense of "none of the above", and was then read
 * as "completed" by everything downstream. It is not the same sentence: "it is done"
 * and "it ended and never said a word" are what a person would tell you about two very
 * different runs.
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
  /**
   * It ran to an ordinary end and left no report: a last turn of tool calls and no
   * words.
   *
   * Named so it cannot be read as a success, because it was being read as one.
   * Measured over 396 stored sessions: 39 ended without a line of closing text, and
   * three of those the core itself called `completed` — 313, 173 and 110 tool calls,
   * nothing said, recorded as work done. Nothing was wrong with the record; the
   * vocabulary had no word for it, so it fell into `finished` with the runs that
   * really had finished.
   */
  | "no-report"
  /** It is done, it said so, and nothing follows. */
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
  /**
   * How the CORE says the run ended: `completed`, `iterations`, `runtime`,
   * `stopped`, or `failed`.
   *
   * Its word, not a translation of it. `atoma` classifies its own ending and
   * records it in the session; `read_run_ending.ts` reads that back. This was two
   * booleans, `limitReached` and `stopRequested`, inferred outside the run from an
   * exit code and whether a file existed — a guess that collapsed two different
   * ceilings into one and raced the watcher writing the file.
   *
   * An unrecognised word lands on `finished`, which is the same place `completed`
   * lands. A core that grows a seventh ending should be read as having finished
   * rather than as having failed, until somebody here decides what it means.
   */
  endedBecause: string;
  /** The cross-run chain reached its own limit. */
  loopLimitReached: boolean;
  /** A tool call already started a follow-up run during this turn. */
  chainContinues: boolean;
  /** The agent's closing line naming who goes next, or empty. */
  directive: string;
  /**
   * Did the run leave a report — did the last thing it said have words in it?
   *
   * An observation, not a claim the agent makes about itself. The session records
   * every message; the last assistant message either carries text or carries only
   * tool calls, and nothing has to be asked or trusted to tell which.
   *
   * The last one rather than any one, because this repository has already measured
   * what an earlier message is worth: these agents write prose exactly once, in their
   * final turn (450 assistant turns with 1 carrying text; 204 with 1; 200 with 0).
   * A sentence from the middle of the work is not a report, and
   * `post_result_comment.ts` labels one as such when it shows it.
   *
   * Read by `read_run_ending.ts`, from the same session it reads `endedBecause` out
   * of, so the two facts about one run come from one file at one moment.
   */
  reported: boolean;
}

/**
 * Read the signals into the one name.
 *
 * The order is the precedence, and it reads downward from "we know least" to "we
 * know most": a run that did not complete tells us nothing about what it intended,
 * so nothing below it is consulted.
 *
 * `stopped` and `spent` are one field now and cannot both hold. They were two
 * booleans guessed from outside, where they could.
 *
 * `spent` covers both of the core's ceilings, `iterations` and `runtime`, because
 * the decisions below turn on the same answer for either: the turn ended without
 * anybody choosing to end it, and nothing it planned will run. Which ceiling is a
 * sentence rather than a decision, so it stays on the word and is read by whatever
 * writes that sentence — see the result comment.
 *
 * `no-report` sits BELOW `handed-off` on purpose, and that placement is most of what
 * makes it usable. A run that ends by calling `create_pr`, `launch_sub_agent` or
 * `request_close_issue` gets no further turn — atoma's loop stops the moment the tool
 * returns — so "the last thing it said" is that tool call. Asked before the hand-off,
 * this would label every one of those as having reported nothing. Asked after, it is
 * left with exactly the runs where nothing continues AND nothing was said.
 */
export function endingOf(signals: TurnSignals): TurnEnding {
  const named = signals.directive.trim();
  const next = named === "" ? undefined : { agent: named };

  if (!signals.succeeded || signals.endedBecause === "failed") return { ended: "failed" };
  if (signals.endedBecause === "stopped") return { ended: "stopped" };
  if (signals.endedBecause === "iterations" || signals.endedBecause === "runtime") return { ended: "spent" };
  if (signals.loopLimitReached) return { ended: "chain-over", ...(next ? { next } : {}) };
  if (next || signals.chainContinues) return { ended: "handed-off", ...(next ? { next } : {}) };
  if (!signals.reported) return { ended: "no-report" };
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

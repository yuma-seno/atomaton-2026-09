import { describe, expect, test } from "bun:test";
import {
  endingOf,
  nextToDispatch,
  refusedByChainLimit,
  shouldReleaseGuard,
  type TurnSignals,
} from "./turn.ts";

function signals(overrides: Partial<TurnSignals> = {}): TurnSignals {
  return {
    succeeded: true,
    endedBecause: "completed",
    loopLimitReached: false,
    chainContinues: false,
    directive: "",
    reported: true,
    ...overrides,
  };
}

const endingFor = (overrides: Partial<TurnSignals> = {}) => endingOf(signals(overrides));

describe("endingOf", () => {
  test("a run that did not complete failed, whatever else it said", () => {
    expect(endingFor({ succeeded: false }).ended).toBe("failed");
    // A directive from a run that crashed is not a hand-off. Nothing below the
    // failure is known to have been meant.
    expect(endingFor({ succeeded: false, directive: "engineer" }).ended).toBe("failed");
  });

  test("a person stopping it is its own ending, not a limit", () => {
    expect(endingFor({ endedBecause: "stopped" }).ended).toBe("stopped");
  });

  test("this run's own ceiling spends it", () => {
    expect(endingFor({ endedBecause: "runtime" }).ended).toBe("spent");
  });

  /** Two different ceilings. A person goes and looks at different things. */
  test("the chain's ceiling is a different ending from this run's", () => {
    expect(endingFor({ loopLimitReached: true }).ended).toBe("chain-over");
    expect(endingFor({ endedBecause: "runtime" }).ended).not.toBe("chain-over");
  });

  test("naming the next agent is a hand-off", () => {
    const ending = endingFor({ directive: "reviewer" });
    expect(ending.ended).toBe("handed-off");
    expect(ending.next).toEqual({ agent: "reviewer" });
  });

  /**
   * A tool call already started the follow-up, so work continues and the guard has
   * to stay held — but there is nobody left to dispatch, because the run is already
   * going.
   */
  test("a tool call having already dispatched is a hand-off with nobody to start", () => {
    const ending = endingFor({ chainContinues: true });
    expect(ending.ended).toBe("handed-off");
    expect(ending.next).toBeUndefined();
  });

  test("nothing continuing at all is finished", () => {
    expect(endingFor().ended).toBe("finished");
  });

  test("whitespace is not a name", () => {
    expect(endingFor({ directive: "   " }).ended).toBe("finished");
  });

  /**
   * The case `finished` used to swallow. Measured over 396 sessions: 39 left no
   * closing text, and three of those the core called `completed` -- 313, 173 and 110
   * tool calls each, recorded as work done.
   */
  test("a run that ended having said nothing is not finished", () => {
    expect(endingFor({ reported: false }).ended).toBe("no-report");
    expect(endingFor({ reported: false }).ended).not.toBe("finished");
  });

  /**
   * The placement that makes the ending usable. A session-ending tool call -- create_pr,
   * launch_sub_agent -- gives the model no further turn, so its last word is that tool
   * call and nothing else. Asked before the hand-off, every one of those would read as
   * a run that reported nothing.
   */
  test("a hand-off is a hand-off whether or not the agent wrote a closing line", () => {
    expect(endingFor({ reported: false, chainContinues: true }).ended).toBe("handed-off");
    expect(endingFor({ reported: false, directive: "reviewer" }).ended).toBe("handed-off");
  });

  /** Every ending above it is a different sentence, and each still wins. */
  test("silence does not rename an ending that already has a name", () => {
    expect(endingFor({ reported: false, succeeded: false }).ended).toBe("failed");
    expect(endingFor({ reported: false, endedBecause: "stopped" }).ended).toBe("stopped");
    expect(endingFor({ reported: false, endedBecause: "runtime" }).ended).toBe("spent");
    expect(endingFor({ reported: false, loopLimitReached: true }).ended).toBe("chain-over");
  });

  /** It ended on its own and named nobody, so there is nobody to start. */
  test("a run that said nothing hands off to nobody", () => {
    expect(endingFor({ reported: false }).next).toBeUndefined();
  });
});

/**
 * One ending holds the guard. Every case below was a separate rule in
 * `serialization-guard.ts`, and each is now the same sentence asked of a name.
 */
describe("shouldReleaseGuard", () => {
  test("releases on every ending that handed back", () => {
    for (const overrides of [
      { succeeded: false },
      { succeeded: false, directive: "engineer" },
      { endedBecause: "stopped" },
      { endedBecause: "runtime" },
      { loopLimitReached: true },
      // Nothing is working on a node whose agent went quiet, so the node must not
      // stay locked against the person the mention is about to fetch.
      { reported: false },
      {},
    ]) {
      expect(shouldReleaseGuard(endingFor(overrides)), JSON.stringify(overrides)).toBe(true);
    }
  });

  test("stays held only while work is still going", () => {
    expect(shouldReleaseGuard(endingFor({ chainContinues: true }))).toBe(false);
    expect(shouldReleaseGuard(endingFor({ directive: "reviewer" }))).toBe(false);
    expect(shouldReleaseGuard(endingFor({ chainContinues: true, directive: "reviewer" }))).toBe(false);
  });

  /** A ceiling reached mid-chain ends the turn even though something was in flight. */
  test("a ceiling beats work in flight", () => {
    expect(shouldReleaseGuard(endingFor({ endedBecause: "runtime", chainContinues: true }))).toBe(true);
    expect(shouldReleaseGuard(endingFor({ loopLimitReached: true, directive: "reviewer" }))).toBe(true);
  });
});

/**
 * The two questions that used to be one four-term Actions expression thirty lines
 * from the step that asked the domain the other one.
 */
describe("who runs next", () => {
  test("a hand-off names who to start", () => {
    expect(nextToDispatch(endingFor({ directive: "reviewer" }))).toEqual({ agent: "reviewer" });
  });

  test("nothing is started on any other ending", () => {
    for (const overrides of [
      { succeeded: false, directive: "reviewer" },
      { endedBecause: "stopped", directive: "reviewer" },
      { endedBecause: "runtime", directive: "reviewer" },
      { loopLimitReached: true, directive: "reviewer" },
      { chainContinues: true },
      { reported: false },
      {},
    ]) {
      expect(nextToDispatch(endingFor(overrides)), JSON.stringify(overrides)).toBeUndefined();
    }
  });

  /**
   * The chain's limit is the one refusal a person is told about by name: somebody
   * was named, and this is where the chain stops rather than taking them.
   */
  test("the chain's limit names who would have run", () => {
    expect(refusedByChainLimit(endingFor({ loopLimitReached: true, directive: "reviewer" }))).toEqual({
      agent: "reviewer",
    });
  });

  test("this run's own ceiling is not that refusal", () => {
    expect(refusedByChainLimit(endingFor({ endedBecause: "runtime", directive: "reviewer" }))).toBeUndefined();
  });

  test("a hand-off that happened is not a refusal", () => {
    expect(refusedByChainLimit(endingFor({ directive: "reviewer" }))).toBeUndefined();
  });

  /** Exactly one of the two can ever be answered, or a step would both run and be explained away. */
  test("no ending both dispatches and refuses", () => {
    for (const overrides of [
      { directive: "reviewer" },
      { loopLimitReached: true, directive: "reviewer" },
      { chainContinues: true },
      { succeeded: false },
      {},
    ]) {
      const ending = endingFor(overrides);
      expect(
        Boolean(nextToDispatch(ending)) && Boolean(refusedByChainLimit(ending)),
        JSON.stringify(overrides),
      ).toBe(false);
    }
  });
});

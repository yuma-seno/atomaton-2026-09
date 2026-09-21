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
    limitReached: false,
    stopRequested: false,
    loopLimitReached: false,
    chainContinues: false,
    directive: "",
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
    expect(endingFor({ stopRequested: true }).ended).toBe("stopped");
  });

  test("this run's own ceiling spends it", () => {
    expect(endingFor({ limitReached: true }).ended).toBe("spent");
  });

  /** Two different ceilings. A person goes and looks at different things. */
  test("the chain's ceiling is a different ending from this run's", () => {
    expect(endingFor({ loopLimitReached: true }).ended).toBe("chain-over");
    expect(endingFor({ limitReached: true }).ended).not.toBe("chain-over");
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
      { stopRequested: true },
      { limitReached: true },
      { loopLimitReached: true },
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
    expect(shouldReleaseGuard(endingFor({ limitReached: true, chainContinues: true }))).toBe(true);
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
      { stopRequested: true, directive: "reviewer" },
      { limitReached: true, directive: "reviewer" },
      { loopLimitReached: true, directive: "reviewer" },
      { chainContinues: true },
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
    expect(refusedByChainLimit(endingFor({ limitReached: true, directive: "reviewer" }))).toBeUndefined();
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

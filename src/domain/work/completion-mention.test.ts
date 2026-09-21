import { describe, expect, test } from "bun:test";
import { shouldMentionOnCompletion, type CompletionSignals } from "./completion-mention.ts";
import { endingOf, type TurnSignals } from "./turn.ts";

/** An ending built the way a run builds it, so these exercise the real derivation. */
const ended = (overrides: Partial<TurnSignals> = {}) =>
  endingOf({
    succeeded: true,
    endedBecause: "completed",
    loopLimitReached: false,
    chainContinues: false,
    directive: "",
    ...overrides,
  });

const base: CompletionSignals = {
  ending: ended(),
  chainContinues: false,
  notify: "someone",
  isSubIssue: false,
  issueClosed: false,
};

describe("shouldMentionOnCompletion", () => {
  test("mentions when a run ends with nothing following it", () => {
    expect(shouldMentionOnCompletion(base)).toBe(true);
  });

  test("says nothing when there is nobody to mention", () => {
    expect(shouldMentionOnCompletion({ ...base, notify: "" })).toBe(false);
  });

  test("says nothing when the agent handed off to another agent", () => {
    expect(shouldMentionOnCompletion({ ...base, ending: ended({ directive: "reviewer" }) })).toBe(false);
  });

  test("says nothing when a tool call already dispatched the next run", () => {
    expect(shouldMentionOnCompletion({ ...base, chainContinues: true })).toBe(false);
  });

  // The case this module exists for: closing a sub-issue is what wakes its
  // parent, and that dispatch happens in a later workflow run, so the run that
  // closed it sees no chain of its own.
  test("says nothing when a closed sub-issue hands back to its parent", () => {
    expect(shouldMentionOnCompletion({ ...base, isSubIssue: true, issueClosed: true })).toBe(false);
  });

  // Nothing wakes a parent for an unfinished sub-task, so this really has
  // stopped -- the one sub-issue case a person must hear about.
  test("still mentions when a sub-issue run ends with the sub-issue open", () => {
    expect(shouldMentionOnCompletion({ ...base, isSubIssue: true, issueClosed: false })).toBe(true);
  });

  // A root issue is nobody's sub-task; closing it ends the work rather than
  // handing it on.
  test("still mentions when a closed issue has no parent", () => {
    expect(shouldMentionOnCompletion({ ...base, issueClosed: true })).toBe(true);
  });

  /**
   * The case that went silent twice. A stopped turn carries no `next`, so the
   * successor it named never runs -- and the directive then silenced
   * the mention as well, leaving nothing running and nobody told.
   */
  test("still mentions when a stop cancelled the handoff the agent named", () => {
    expect(shouldMentionOnCompletion({ ...base, ending: ended({ directive: "reviewer", endedBecause: "stopped" }) })).toBe(true);
  });

  /** A spent budget is the same: the turn ended, and what it planned did not happen. */
  test("still mentions when a spent budget cancelled the handoff", () => {
    expect(shouldMentionOnCompletion({ ...base, ending: ended({ directive: "reviewer", endedBecause: "runtime" }) })).toBe(true);
  });

  /**
   * Only the directive is contradicted by a stop. A tool that already dispatched has
   * already dispatched -- that run is going whatever happened to this one -- so the
   * mention would be claiming a halt that did not happen.
   */
  test("a stop does not un-silence a dispatch that already went out", () => {
    expect(shouldMentionOnCompletion({ ...base, chainContinues: true, ending: ended({ endedBecause: "stopped" }) })).toBe(false);
  });

  /** Nor the parent hand-back: the sub-issue is closed, and closing it is the signal. */
  test("a stop does not un-silence a closed sub-issue's hand-back", () => {
    expect(
      shouldMentionOnCompletion({ ...base, isSubIssue: true, issueClosed: true, ending: ended({ endedBecause: "stopped" }) }),
    ).toBe(false);
  });
});

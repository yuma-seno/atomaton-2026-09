import { describe, expect, test } from "bun:test";
import {
  commandOnClosedNotice,
  dispatchRefusedNotice,
  mayStartWorkOn,
  mentionsForClose,
  recoveryAdvice,
  stopOnCloseNotice,
  type TargetState,
} from "./closed-issue.ts";

const OPEN: TargetState = { kind: "open" };
const CLOSED: TargetState = { kind: "closed", merged: false };
const MERGED: TargetState = { kind: "closed", merged: true };
const UNKNOWN: TargetState = { kind: "unknown", why: "gh exited 1" };

describe("mayStartWorkOn", () => {
  test("only an open target takes work", () => {
    expect(mayStartWorkOn(OPEN)).toBe(true);
    expect(mayStartWorkOn(CLOSED)).toBe(false);
    expect(mayStartWorkOn(MERGED)).toBe(false);
  });

  /**
   * The whole point of the `unknown` case. A lookup that failed is not evidence that
   * the target is open, and every guard in this repository that has gone wrong went
   * wrong by answering an unanswerable question with the permissive value.
   */
  test("a state that could not be read does not take work either", () => {
    expect(mayStartWorkOn(UNKNOWN)).toBe(false);
  });
});

describe("recoveryAdvice", () => {
  test("a closed issue is reopened", () => {
    expect(recoveryAdvice(CLOSED, 803, "/orchestrator")).toContain("Reopen #803");
  });

  /**
   * GitHub offers no way to reopen a merged pull request, so advice to reopen one is
   * advice that cannot be followed.
   */
  test("a merged pull request is never told to reopen", () => {
    const advice = recoveryAdvice(MERGED, 826, "/engineer");
    expect(advice).not.toContain("Reopen");
    expect(advice).toContain("Open an issue");
  });
});

describe("mentionsForClose", () => {
  test("the closer is always told", () => {
    expect(mentionsForClose("alice", "", false)).toEqual(["alice"]);
  });

  test("a human author is told as well", () => {
    expect(mentionsForClose("alice", "bob", false)).toEqual(["alice", "bob"]);
  });

  /**
   * Most issues here are filed by an agent. Mentioning the bot that filed one is noise
   * in a notice whose whole value is that people read it.
   */
  test("an agent that filed the issue is not mentioned", () => {
    expect(mentionsForClose("alice", "github-actions[bot]", true)).toEqual(["alice"]);
  });

  test("closing your own issue mentions you once", () => {
    expect(mentionsForClose("alice", "alice", false)).toEqual(["alice"]);
  });
});

describe("stopOnCloseNotice", () => {
  const notice = stopOnCloseNotice(["alice", "bob"], 803);

  test("mentions everyone it was given", () => {
    expect(notice).toContain("@alice @bob");
  });

  /**
   * Three facts, each of which the person cannot get from what they can see: the run
   * did not stop when they closed it, it is not stopping instantly, and the issue is
   * not coming back on its own.
   */
  test("says the close did not stop the run", () => {
    expect(notice).toContain("Closing does not stop a run by itself");
  });

  test("says the stop is not instant", () => {
    expect(notice).toContain("after its current step");
  });

  test("says the issue stays closed, and how to continue", () => {
    expect(notice).toContain("#803 stays closed");
    expect(notice).toContain("/resume");
  });
});

describe("commandOnClosedNotice", () => {
  test("names the command that did not run, and why", () => {
    const notice = commandOnClosedNotice("alice", "/engineer", CLOSED, 803);
    expect(notice).toContain("@alice");
    expect(notice).toContain("`/engineer` was not run");
    expect(notice).toContain("#803 is closed");
    expect(notice).toContain("Reopen #803");
  });

  test("a merged pull request gets advice it can act on", () => {
    const notice = commandOnClosedNotice("alice", "/engineer", MERGED, 826);
    expect(notice).toContain("Open an issue");
    expect(notice).not.toContain("Reopen");
  });

  test("an unreadable state says so rather than naming a state it does not know", () => {
    const notice = commandOnClosedNotice("alice", "/engineer", UNKNOWN, 803);
    expect(notice).toContain("could not be read");
    expect(notice).not.toContain("is closed");
  });
});

describe("dispatchRefusedNotice", () => {
  const notice = dispatchRefusedNotice({
    agent: "orchestrator",
    number: 803,
    context: "all sub-issues of #803 are complete, so its orchestrator was to be re-invoked",
    state: CLOSED,
    notify: "alice",
  });

  test("mentions whoever asked for the run", () => {
    expect(notice).toContain("@alice");
  });

  /**
   * The difference between this notice and a log line. A person who did not ask for a
   * dispatch does not care that one was refused; they care what is now not going to
   * happen.
   */
  test("says what was about to happen, not just that a dispatch was refused", () => {
    expect(notice).toContain("all sub-issues of #803 are complete");
  });

  test("says nothing will retry", () => {
    expect(notice).toContain("Nothing will retry");
  });

  test("says how to start it by hand", () => {
    expect(notice).toContain("Reopen #803");
    expect(notice).toContain("/orchestrator");
  });

  test("an unreadable state does not claim the target is closed", () => {
    const unknown = dispatchRefusedNotice({
      agent: "orchestrator",
      number: 803,
      context: "x",
      state: UNKNOWN,
      notify: "",
    });
    expect(unknown).toContain("could not be read");
    expect(unknown).not.toContain("is closed");
    // Nobody to mention is normal, and must not produce a stray "@".
    expect(unknown).not.toContain("@");
  });
});

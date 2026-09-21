import { describe, expect, test } from "bun:test";
import {
  commandOnClosedNotice,
  dispatchRefusedNotice,
  mayStartWorkOn,
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

/**
 * A receipt, and everything it says is something the workflow posting it knows.
 *
 * The run's own result comment follows ten to thirty seconds later. The two used to
 * overlap on every line and mention the same person twice, and this half was the one
 * saying things it could not know yet.
 */
describe("stopOnCloseNotice", () => {
  const notice = stopOnCloseNotice(803);

  /**
   * Two facts the person cannot get from what they can see: the run did not stop
   * when they closed it, and it is not stopping instantly either.
   */
  test("says the close did not stop the run", () => {
    expect(notice).toContain("Closing does not stop a run by itself");
  });

  test("says the stop is not instant", () => {
    expect(notice).toContain("after its current step");
  });

  test("says the issue stays closed, and that the run will report", () => {
    expect(notice).toContain("#803 stays closed");
    expect(notice).toContain("report here");
  });

  /**
   * The run saves the session, and it has not stopped yet. Claiming otherwise here
   * was a sentence about something that had not happened.
   */
  test("does not claim what only the run can know", () => {
    expect(notice).not.toContain("session is saved");
    expect(notice).not.toContain("/resume");
  });

  /**
   * A mention means "your turn". The person who just closed the issue has taken
   * theirs and has nothing to do but wait; the turn comes back when the run reports,
   * and that comment mentions them. One event, one notification.
   */
  test("notifies nobody", () => {
    expect(notice).not.toContain("@");
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

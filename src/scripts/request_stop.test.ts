import { describe, expect, test } from "bun:test";
import { stopRequestedNotice } from "./request_stop.ts";
import { LLM_CONTEXT_TAG, STOP_TAG } from "../adapters/github/tags.ts";

describe("request_stop.ts", () => {
  // The notice IS the request: the running job polls for this tag. A notice that
  // reads well and carries no tag would tell the person a stop is coming and stop
  // nothing.
  test("carries the tag the running job polls for", () => {
    expect(STOP_TAG.has(stopRequestedNotice("octocat", true, []))).toBe(true);
  });

  // A stop must not become the next run's context, and neither must the notice
  // about it.
  test("is excluded from the agent's context", () => {
    expect(stopRequestedNotice("octocat", true, [])).toContain(LLM_CONTEXT_TAG.write("exclude"));
  });

  // A receipt, not a call to action. The run posts its own result comment seconds
  // later and mentions them there; a mention here would be a second notification for
  // one event, saying what the other one is about to say.
  test("names whose comment it was, and notifies nobody", () => {
    const notice = stopRequestedNotice("octocat", true, []);
    expect(notice).toContain("octocat's");
    expect(notice).not.toContain("@octocat");
    expect(stopRequestedNotice("", true, [])).toContain("The `/stop` comment");
  });

  // The existing in-progress guard also deletes comments. Someone whose `/stop`
  // vanished with no explanation could not tell which of the two happened.
  test("says what became of the comment, either way", () => {
    expect(stopRequestedNotice("octocat", true, [])).toContain("was removed");
    expect(stopRequestedNotice("octocat", false, [])).toContain("could not be removed");
  });

  // The lag is what people will misread: a stop is picked up on the next poll and
  // taken at the next turn, so the agent can finish a tool call and start another.
  test("says the stop is not immediate, and that the run will report", () => {
    const notice = stopRequestedNotice("octocat", true, []);
    expect(notice).toContain("current step");
    expect(notice).toContain("report here");
    // The run saves the session; until it has, this cannot say so.
    expect(notice).not.toContain("session is saved");
    expect(notice).not.toContain("/resume");
  });

  // A stop reaches the work under the issue it was typed on, so the notice names
  // what it reached. It used to name the opposite -- the work it could NOT reach,
  // with instructions to go and stop each piece by hand.
  test("names the work under this issue that the stop also reached", () => {
    const notice = stopRequestedNotice("octocat", true, [12, 13]);
    expect(notice).toContain("#12, #13");
    expect(notice).toContain("also reached");
    expect(notice).not.toContain("does not reach");
    // One command brings all of it back, which is the half that makes the reach fair.
    expect(notice).toContain("/resume");
  });

  test("says nothing about other work when the stop reached none", () => {
    expect(stopRequestedNotice("octocat", true, [])).not.toContain("also reached");
  });
});

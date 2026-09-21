import { describe, expect, test } from "bun:test";
import { CLOSE_REQUEST_LINE, closeRequestComment } from "./close-request.ts";

describe("closeRequestComment", () => {
  test("asks in the first line, above what the agent had to say", () => {
    const comment = closeRequestComment({ notify: "alice", body: "Atomaton: work complete.\n\n**Reason:** merged" });
    const [first] = comment.split("\n");
    expect(first).toBe(`@alice ${CLOSE_REQUEST_LINE}`);
    // The report follows it rather than burying it.
    expect(comment.indexOf(CLOSE_REQUEST_LINE)).toBeLessThan(comment.indexOf("**Reason:**"));
  });

  test("still posts the request when nobody could be resolved to mention", () => {
    const comment = closeRequestComment({ notify: "", body: "Atomaton: work complete." });
    expect(comment.startsWith(CLOSE_REQUEST_LINE)).toBe(true);
    expect(comment).not.toContain("@");
  });

  test("is the request alone when the caller has nothing to add", () => {
    expect(closeRequestComment({ notify: "bob" })).toBe(`@bob ${CLOSE_REQUEST_LINE}`);
    expect(closeRequestComment({ notify: "bob", body: "   " })).toBe(`@bob ${CLOSE_REQUEST_LINE}`);
  });

  test("does not say the tool refused anything", () => {
    const comment = closeRequestComment({ notify: "alice", body: "done" });
    for (const word of ["refus", "cannot", "could not", "failed", "not be closed"]) {
      expect(comment.toLowerCase()).not.toContain(word);
    }
  });
});

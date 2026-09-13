import { describe, expect, test } from "bun:test";
import { claimsToClose, closedIssueNumber, closingKeywordRefusal, closingReferences, dedupeByNumber } from "./issue-links.ts";

describe("claimsToClose", () => {
  // The case this exists for. PR #284 carried `Closes #281` and targeted
  // `atoma/issue-280`, so GitHub formed no closing link and `willCloseTarget`
  // reported false. Without reading the body, a sub-issue's pull request is
  // invisible -- and a sub-issue is exactly where "we decided X" sits above an
  // unmerged pull request.
  test("finds a closing keyword for the issue", () => {
    expect(claimsToClose("<!-- atoma:parent-issue=281 -->\nCloses #281\n\nAdds a section.", 281)).toBe(true);
  });

  test("accepts the keywords GitHub accepts, in any case", () => {
    for (const line of ["closes #7", "Closed #7", "Fix #7", "fixes #7", "FIXED #7", "resolve #7", "Resolves #7"]) {
      expect(claimsToClose(line, 7), line).toBe(true);
    }
  });

  test("accepts the colon form GitHub also accepts", () => {
    expect(claimsToClose("Closes: #7", 7)).toBe(true);
  });

  // A pull request mentioned one issue while closing another. Counting it would attach the
  // parent's delivery to the child and report work as landed that is not.
  test("rejects a pull request that merely mentions the issue", () => {
    expect(claimsToClose("Issue #281 の作業成果です。", 281)).toBe(false);
  });

  test("does not confuse one issue number for another", () => {
    expect(claimsToClose("Closes #2810", 281)).toBe(false);
    expect(claimsToClose("Closes #281", 28)).toBe(false);
  });

  test("ignores a keyword that is not attached to a number", () => {
    expect(claimsToClose("This closes the discussion. See #281.", 281)).toBe(false);
  });
});

describe("dedupeByNumber", () => {
  test("keeps the first mention, so an authoritative source wins", () => {
    const declared = [{ number: 9, merged: true }];
    const referenced = [{ number: 9, merged: false }, { number: 4, merged: false }];
    expect(dedupeByNumber(declared, referenced)).toEqual([
      { number: 4, merged: false },
      { number: 9, merged: true },
    ]);
  });

  test("survives having nothing to merge", () => {
    expect(dedupeByNumber<{ number: number }>([], [])).toEqual([]);
  });
});

/**
 * The cases the hand-written `/Closes #(\d+)/` in `parse_pr_metadata.ts` used to miss.
 *
 * Each one is silent: the tool that decides whether to INJECT a closing line matches all
 * six keywords case-insensitively, so it adds nothing, and the parser then finds nothing
 * either. `sub_number` comes out empty, the jobs gated on it are skipped, and the parent
 * is never told its sub-issue finished.
 */
describe("closedIssueNumber", () => {
  test("reads every keyword GitHub documents, in any case", () => {
    for (const body of [
      "Closes #12",
      "closes #12",
      "Closed #12",
      "Fixes #12",
      "fixed #12",
      "Resolve #12",
      "resolves: #12",
      "Closes  #12",
      "This closes #12 now",
    ]) {
      expect(closedIssueNumber(body), body).toBe(12);
    }
  });

  test("a mention that claims nothing is not a closure", () => {
    for (const body of ["see #12", "mentions #12 in passing", "related to #12", ""]) {
      expect(closedIssueNumber(body), body).toBeUndefined();
    }
  });

  test("agrees with claimsToClose, which asks the same rule the other way round", () => {
    const body = "resolved: #281";
    expect(closedIssueNumber(body)).toBe(281);
    expect(claimsToClose(body, 281)).toBe(true);
  });
});

/**
 * The guard's own reader, which has to catch forms the two above deliberately do not.
 *
 * `claimsToClose` and `closedIssueNumber` answer questions about issues in this
 * repository, so a cross-repository reference is correctly invisible to them. A rule
 * about what an agent may write cannot share that blind spot: a keyword aimed at another
 * repository closes an issue nothing here will ever show.
 */
describe("closingReferences", () => {
  /** Checked against GitHub's documentation, not remembered. */
  test("every keyword GitHub documents, and only those", () => {
    expect(
      closingReferences("close #1 closed #2 fix #3 fixes #4 fixed #5 resolve #6 resolves #7 resolved #8 closes #9"),
    ).toHaveLength(9);
    expect(closingReferences("addresses #1 completes #2 see #3 issue #4")).toEqual([]);
  });

  test("the forms GitHub accepts around the keyword", () => {
    expect(closingReferences("CLOSES: #10")).toEqual(["CLOSES: #10"]);
    expect(closingReferences("Closes:  #10")).toEqual(["Closes:  #10"]);
  });

  /** The dangerous one: it closes an issue nothing in this repository will show. */
  test("a cross-repository reference is found", () => {
    expect(closingReferences("Fixes octo-org/octo-repo#100")).toEqual(["Fixes octo-org/octo-repo#100"]);
  });

  test("several in one line, as GitHub's own example writes them", () => {
    expect(closingReferences("Resolves #10, resolves octo-org/octo-repo#100")).toEqual([
      "Resolves #10",
      "resolves octo-org/octo-repo#100",
    ]);
  });

  /**
   * Documentation explaining the rule is not an attempt to break it, and a rule that
   * could not be written down in its own docs would be unusable.
   */
  test("code is left alone", () => {
    expect(closingReferences("write `Closes #1` in the body")).toEqual([]);
    expect(closingReferences("```\nCloses #1\n```")).toEqual([]);
  });

  test("the same reference twice is reported once", () => {
    expect(closingReferences("Closes #1 and Closes #1")).toEqual(["Closes #1"]);
  });
});

describe("closingKeywordRefusal", () => {
  test("nothing found, nothing said", () => {
    expect(closingKeywordRefusal([], "pull request body")).toBeUndefined();
  });

  /**
   * A refusal rather than an escape, and it has to name the route that works: measured
   * three times in this project, a refusal saying what to do instead is followed and one
   * that only states a rule is not.
   */
  test("it quotes what it found and names the tool to use", () => {
    const refusal = closingKeywordRefusal(["Closes #1"], "pull request body")!;
    expect(refusal).toContain('"Closes #1"');
    expect(refusal).toContain("pull request body");
    expect(refusal).toContain("github__close_issue");
    expect(refusal).toContain("added for you");
  });
});

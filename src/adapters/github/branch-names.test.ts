import { describe, expect, test } from "bun:test";
import { branchNameFor, branchOfIssue, isIssueBranch, matchingRefsPath, ordinalOfBranch } from "./branch-names.ts";

describe("ordinalOfBranch", () => {
  test("the plain name is the first", () => {
    expect(ordinalOfBranch("atomaton/issue-12", 12)).toBe(1);
  });

  test("a numeric suffix is the ordinal", () => {
    expect(ordinalOfBranch("atomaton/issue-12-2", 12)).toBe(2);
    expect(ordinalOfBranch("atomaton/issue-12-10", 12)).toBe(10);
  });

  // `atomaton/issue-1` must not claim `atomaton/issue-12`'s branches.
  test("an issue whose number is a prefix of another owns nothing of it", () => {
    expect(ordinalOfBranch("atomaton/issue-120", 12)).toBe(0);
    expect(ordinalOfBranch("atomaton/issue-12-x", 12)).toBe(0);
  });

  /**
   * The case the anchoring exists for, and the one an earlier version missed: it is
   * the *suffixed* branch of the longer number that got claimed. For issue 1 the
   * remainder of `atomaton/issue-12-3` is `2-3`, and an unanchored search for a
   * trailing `-<digits>` finds one — so issue 1 resumed issue 12's work, committed
   * to it, and opened a pull request from it.
   */
  test("nor the suffixed branch of an issue whose number is longer", () => {
    expect(ordinalOfBranch("atomaton/issue-12-3", 1)).toBe(0);
    expect(ordinalOfBranch("atomaton/issue-120-7", 12)).toBe(0);
  });

  test("a branch belonging to no issue is owned by none", () => {
    expect(ordinalOfBranch("main", 12)).toBe(0);
    expect(ordinalOfBranch("feature/thing", 12)).toBe(0);
  });
});

describe("branchNameFor", () => {
  test("the first branch carries no suffix", () => {
    expect(branchNameFor(12, 1)).toBe("atomaton/issue-12");
  });

  test("the rest carry their ordinal", () => {
    expect(branchNameFor(12, 2)).toBe("atomaton/issue-12-2");
    expect(branchNameFor(12, 6)).toBe("atomaton/issue-12-6");
  });

  /** Round-trips, which is the only thing that keeps the two halves agreeing. */
  test("every name it writes is one it reads back the same way", () => {
    for (const ordinal of [1, 2, 9, 10, 137]) {
      expect(ordinalOfBranch(branchNameFor(12, ordinal), 12), `ordinal ${ordinal}`).toBe(ordinal);
    }
  });

  test("a parent's branch is its first", () => {
    expect(branchOfIssue(803)).toBe("atomaton/issue-803");
  });
});

describe("isIssueBranch", () => {
  test("recognises a work branch whichever issue it belongs to", () => {
    expect(isIssueBranch("atomaton/issue-12")).toBe(true);
    expect(isIssueBranch("atomaton/issue-12-4")).toBe(true);
  });

  test("and nothing else", () => {
    expect(isIssueBranch("main")).toBe(false);
    expect(isIssueBranch("feature/atomaton/issue-12")).toBe(false);
  });
});

/** The one place the prefix reaches an API path, so it is held to the same constant. */
describe("matchingRefsPath", () => {
  test("asks for the refs an issue might own", () => {
    expect(matchingRefsPath("owner/repo", 12)).toBe(
      "repos/owner/repo/git/matching-refs/heads/atomaton/issue-12",
    );
  });
});

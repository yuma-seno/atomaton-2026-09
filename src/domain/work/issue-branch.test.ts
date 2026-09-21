import { describe, expect, test } from "bun:test";
import { nextOrdinal, ordinalToResume, type OwnedBranch } from "./issue-branch.ts";

const at = (ordinal: number, merged = false): OwnedBranch => ({ ordinal, merged });

describe("ordinalToResume", () => {
  test("nothing to resume when the issue has no branch", () => {
    expect(ordinalToResume([])).toBeUndefined();
  });

  test("resumes an unmerged branch", () => {
    expect(ordinalToResume([at(1)])).toBe(1);
  });

  // The case that stops a completion check from creating a branch: everything
  // this issue owned has landed, so there is nothing to continue.
  test("stays on the base once every branch has merged", () => {
    expect(ordinalToResume([at(1, true)])).toBeUndefined();
  });

  test("resumes the newest unmerged branch when work continued after a merge", () => {
    expect(ordinalToResume([at(1, true), at(2)])).toBe(2);
  });

  // Numeric ordering, not lexicographic: 10 is newer than 9. The names these come
  // from sort the other way, which is why the rule works on numbers.
  test("orders numerically", () => {
    expect(ordinalToResume([at(9, true), at(10)])).toBe(10);
  });

  test("reads them in whatever order they arrive", () => {
    expect(ordinalToResume([at(2), at(10), at(1, true)])).toBe(10);
  });
});

describe("nextOrdinal", () => {
  test("the first branch is the first", () => {
    expect(nextOrdinal([])).toBe(1);
  });

  test("counts up once the first is taken", () => {
    expect(nextOrdinal([at(1, true)])).toBe(2);
  });

  // From the highest taken, not from how many exist, so deleting an old branch
  // cannot hand out a number that was already used.
  test("counts from the highest rather than from the count", () => {
    expect(nextOrdinal([at(1, true), at(5, true)])).toBe(6);
  });
});

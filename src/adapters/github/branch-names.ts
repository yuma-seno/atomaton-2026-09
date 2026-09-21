/**
 * branch-names.ts — how a work branch is spelled, and nothing about what to do
 * with one.
 *
 * `atomaton/issue-<n>`, and `atomaton/issue-<n>-<k>` for the second and later. That
 * is a convention: it says which issue a branch belongs to by putting the number in
 * the name, because git has nowhere else to put it. Which branch to resume, and
 * whether a new one is needed at all, are work rules and live in
 * `domain/work/issue-branch.ts`.
 *
 * The two were one module, and the convention was written out in four places: twice
 * in the rule, once as `BRANCH_PREFIX` beside the placement logic, and once inside
 * a `matching-refs` path. Nothing had gone wrong with that yet, which is the usual
 * state of a literal repeated four times.
 */

/** What every work branch starts with. The issue number follows it. */
export const BRANCH_PREFIX = "atomaton/issue-";

/**
 * What may follow `atomaton/issue-<n>` in a branch that issue owns.
 *
 * Anchored at both ends, which is the whole point. Unanchored, the remainder of
 * `atomaton/issue-12-3` after the prefix for issue **1** is `2-3`, and a pattern
 * looking only for a trailing `-<digits>` finds one — so a run on issue 1 would
 * resume issue 12's branch, commit to it, and open a pull request from it.
 *
 * The check used to live in two places, the filter and the ordinal, each unanchored
 * in the same way. One arbiter: an ordinal of 0 means the branch is not this
 * issue's, and nothing else decides ownership.
 */
const OWNED_SUFFIX = /^-(\d+)$/;

/** The branch for issue `issue`, at `ordinal`. The first has no suffix. */
export function branchNameFor(issue: number, ordinal: number): string {
  const base = `${BRANCH_PREFIX}${issue}`;
  return ordinal <= 1 ? base : `${base}-${ordinal}`;
}

/** A parent issue's first branch name. */
export function branchOfIssue(issue: number): string {
  return branchNameFor(issue, 1);
}

/** Whether a branch name is one of Atomaton's work branches, whichever issue it belongs to. */
export function isIssueBranch(name: string): boolean {
  return name.startsWith(BRANCH_PREFIX);
}

/**
 * Which of `issue`'s branches this is: 1 for the first, 2 for `-2`, and 0 for a
 * name this issue does not own.
 */
export function ordinalOfBranch(name: string, issue: number): number {
  const base = `${BRANCH_PREFIX}${issue}`;
  if (!name.startsWith(base)) return 0;
  const rest = name.slice(base.length);
  if (rest === "") return 1;
  const match = OWNED_SUFFIX.exec(rest);
  return match ? Number(match[1]) : 0;
}

/** The `matching-refs` path that lists every branch an issue might own. */
export function matchingRefsPath(repo: string, issue: number): string {
  return `repos/${repo}/git/matching-refs/heads/${BRANCH_PREFIX}${issue}`;
}

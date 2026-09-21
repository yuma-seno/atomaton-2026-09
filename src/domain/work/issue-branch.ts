/**
 * issue-branch.ts — decides which of an issue's branches work belongs on.
 *
 * Two questions, both pure: which existing one a run should resume, and which
 * comes next when none can be. The I/O half — listing refs and asking GitHub which
 * pull requests merged — lives in the callers.
 *
 * The rule everything here follows is that **a branch belongs to a unit of work,
 * not to an issue**. An issue can produce a second piece of work after the first
 * has merged, and reusing the merged branch for it would build on a history the
 * base already contains.
 *
 * ## Ordinals, not names
 *
 * This used to answer with `atomaton/issue-7`, and to find its own inputs by
 * matching that prefix. The name is a convention — git has nowhere else to record
 * which issue a branch belongs to — and belongs with the rest of the mechanism, in
 * `adapters/github/branch-names.ts`. What is left here is the part that is about
 * the work: of the branches this issue owns, which one a run continues, and which
 * number a new one takes.
 *
 * So these take ordinals and answer with ordinals. The caller does the spelling,
 * once, through the module that owns it.
 */

/** One branch an issue owns, as the rule needs to see it. */
export interface OwnedBranch {
  /** 1 for the first, 2 for the second, and so on. Nothing here is ever 0: that means unowned. */
  ordinal: number;
  /** True when a pull request from this branch was merged. */
  merged: boolean;
}

/** Newest first, which is the order both rules below read them in. */
function newestFirst(owned: readonly OwnedBranch[]): OwnedBranch[] {
  return [...owned].sort((a, b) => b.ordinal - a.ordinal);
}

/**
 * The branch a run should continue, or `undefined` to stay on the base branch.
 *
 * The newest whose work has not merged, so a run that follows an interrupted one
 * picks up where it stopped. Once everything has merged there is nothing to resume,
 * and staying on the base is what keeps a run that only reports or closes something
 * from creating a branch it will never commit to.
 */
export function ordinalToResume(owned: readonly OwnedBranch[]): number | undefined {
  return newestFirst(owned).find((branch) => !branch.merged)?.ordinal;
}

/**
 * The number a branch starting now should take.
 *
 * Only asked when nothing is resumable, so every branch here has merged and the
 * name has to be a new one.
 *
 * Normally there are none: a merge deletes its branch, so the first name is free
 * again and the common case stays readable. The rest is for when one survived
 * anyway — a deletion that failed, or a merge made outside Atomaton — where reusing
 * the name would build on history the base already contains.
 *
 * Counts from the highest taken rather than from how many exist, so removing an old
 * branch cannot hand out a name that was already used.
 */
export function nextOrdinal(owned: readonly OwnedBranch[]): number {
  const highest = newestFirst(owned)[0];
  return highest === undefined ? 1 : highest.ordinal + 1;
}

/**
 * issue-branches.ts — lists an issue's branches as they exist on the remote.
 *
 * The I/O half of `domain/work/issue-branch.ts`: that module decides which branch to
 * resume and what to call a new one, this one goes and asks GitHub. Both callers
 * need it — the runner, to resume a branch before the agent starts, and the
 * GitHub MCP server, to name a branch at the first commit — and shared code
 * belongs here rather than in either of them, since a bundled script cannot
 * import another script's entry point.
 */
import { gh } from "./gh.ts";
import { matchingRefsPath, ordinalOfBranch } from "./branch-names.ts";
import { ordinalToResume, type OwnedBranch } from "../../domain/work/issue-branch.ts";

/**
 * A branch that exists on the remote, with the two things a caller needs of it.
 *
 * `ordinal` comes from the name, through the module that owns the convention, and
 * every branch here has one above zero: a ref this issue does not own is dropped
 * before anything asks GitHub whether it merged.
 */
export interface IssueBranch extends OwnedBranch {
  name: string;
}

function log(message: string): void {
  console.error(`[atomaton-issue-branch] ${message}`);
}

/**
 * The remote branches that could belong to this issue, each marked with whether
 * its work merged.
 *
 * Scoped to one issue rather than listing every `atomaton/issue-*` branch, because
 * the merged flag has to be asked for per branch and a repository accumulates
 * hundreds. The prefix over-collects even so — `atomaton/issue-12` matches
 * `atomaton/issue-120` — and `branch-names.ts` settles ownership below, before
 * anything asks whether a branch merged.
 *
 * Merged is read from the pull requests rather than from git ancestry: a squash
 * merge leaves no ancestry to follow, so a branch whose work is in the base
 * would still look unmerged — and a run that believed that would resume a branch
 * whose commits are already released.
 *
 * ## Why it says whether it knows
 *
 * It used to return `[]` for both "this issue has no branches" and "the list could
 * not be read", and the two callers want opposite things from that.
 *
 * `resolve_issue_branch.ts` picks a branch to RESUME, and an unread list is safely
 * "start from the base branch" — which is what the empty answer gave it, correctly
 * and by accident.
 *
 * `branch-placement.ts` picks a name to CREATE, through `nextOrdinal`, and there
 * an unread list means the first name: `atomaton/issue-7`, even when `-2` and `-3`
 * already exist. The push is not forced, so git rejects the divergence and the run
 * fails — loudly, but reporting a non-fast-forward rather than the failed read three
 * steps earlier.
 *
 * So the answer carries whether it is one. Each caller decides what an unknown means
 * to it, which is the only place that question can be answered.
 */
export type IssueBranchesRead =
  | { readonly known: true; readonly branches: IssueBranch[] }
  | { readonly known: false; readonly why: string };

export function collectIssueBranches(repo: string, issueNumber: number): IssueBranchesRead {
  const refs = gh("api", matchingRefsPath(repo, issueNumber));
  if (refs.code) {
    const why = `could not list the branches of #${issueNumber}: ${(refs.stderr || refs.stdout).trim()}`;
    log(`WARN ${why}`);
    return { known: false, why };
  }

  let names: string[];
  try {
    const parsed = JSON.parse(refs.stdout || "[]") as { ref: string }[];
    names = parsed.map((entry) => entry.ref.replace(/^refs\/heads\//, ""));
  } catch {
    const why = `the branch list for #${issueNumber} was not valid JSON`;
    log(`WARN ${why}`);
    return { known: false, why };
  }

  // Ownership is settled before anything asks whether a branch merged. The
  // `matching-refs` prefix over-collects — `atomaton/issue-12` matches
  // `atomaton/issue-120` — and each survivor costs a request, so dropping the ones
  // this issue does not own here is both the correct place and the cheap one.
  const owner = repo.split("/", 1)[0] ?? "";
  const branches = names
    .map((name) => ({ name, ordinal: ordinalOfBranch(name, issueNumber) }))
    .filter((entry) => entry.ordinal > 0)
    .map((entry) => ({ ...entry, merged: headBranchMerged(repo, owner, entry.name) }));
  return { known: true, branches };
}

/**
 * Whether any pull request from this branch was merged.
 *
 * Asks by head branch instead of scanning the repository's pull requests: that
 * list is paginated newest-first, so a branch whose pull request has since
 * fallen off the first page would read as unmerged. The number of branches one
 * issue owns is small, and this is only reached for those.
 */
function headBranchMerged(repo: string, owner: string, branch: string): boolean {
  const prs = gh("api", `repos/${repo}/pulls?state=all&per_page=100&head=${owner}:${branch}`);
  if (prs.code) {
    log(`WARN could not read pull requests for ${branch}; treating it as unmerged`);
    return false;
  }
  try {
    const parsed = JSON.parse(prs.stdout || "[]") as { merged_at?: string | null }[];
    return parsed.some((pr) => Boolean(pr.merged_at));
  } catch {
    log(`WARN pull request list for ${branch} was not valid JSON`);
    return false;
  }
}

/**
 * The name of the branch a run should continue, or `""` to stay on the base.
 *
 * The rule is `ordinalToResume`; this turns its answer back into the name the
 * caller checks out. `""` rather than `undefined` because the one caller writes it
 * straight to `$GITHUB_OUTPUT`, where an absent value and an empty one are the same
 * thing and the empty one is what the step's condition reads.
 */
export function resumableBranch(branches: readonly IssueBranch[]): string {
  const ordinal = ordinalToResume(branches);
  return branches.find((branch) => branch.ordinal === ordinal)?.name ?? "";
}

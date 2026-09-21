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
import type { IssueBranch } from "../domain/work/issue-branch.ts";

function log(message: string): void {
  console.error(`[atomaton-issue-branch] ${message}`);
}

/**
 * The remote branches that could belong to this issue, each marked with whether
 * its work merged.
 *
 * Scoped to one issue rather than listing every `atomaton/issue-*` branch, because
 * the merged flag has to be asked for per branch and a repository accumulates
 * hundreds. `atomaton/issue-12` also matches `atomaton/issue-120` here; separating
 * them is `domain/work/issue-branch.ts`'s job, and over-collecting is the safe
 * direction.
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
 * `branch-placement.ts` picks a name to CREATE, through `nextBranchName`, and there
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
  const refs = gh("api", `repos/${repo}/git/matching-refs/heads/atomaton/issue-${issueNumber}`);
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

  const owner = repo.split("/", 1)[0] ?? "";
  return { known: true, branches: names.map((name) => ({ name, merged: headBranchMerged(repo, owner, name) })) };
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

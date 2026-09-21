# The branch a run commits to

- A branch is created at the first commit, not at the start of a run. A run that
  only reports, confirms a merge, or closes an issue leaves no branch behind.
- The name is `atomaton/issue-N`. A merge deletes the branch, so the same issue's
  next piece of work takes that name again, cut fresh from the base branch.
- If a merged branch is still there — a deletion that failed, or a merge made
  some other way — the next name counts up instead: `atomaton/issue-N-2`, then
  `atomaton/issue-N-3`. Work never resumes on merged history.
- When an unmerged branch is left behind, the issue's next run resumes it
  instead of starting from the base branch.
- A sub-issue's branch is cut from its parent's and merges back into it, so
  sibling tasks see each other's work as it lands. The parent's branch is created
  from the base branch when the first child commits — until then it does not
  exist — and reaches the base branch as one pull request once every child is
  done. Deployment is not dispatched for a merge into a parent branch: that work
  is still in progress, and only the final pull request into the base branch
  carries it to release.

Which branch the first of these is cut from is
[`base_branch`](../reference.md#base_branch), and the tree these branches follow is
[work is a tree of issues](work-is-a-tree-of-issues.md).

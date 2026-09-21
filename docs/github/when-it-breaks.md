# When a check will not settle

Two of these are GitHub's own behaviour rather than Atomaton's, and neither is
fixable from `config.yaml`.

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| An agent's pull request shows a check stuck at `action_required` | GitHub holds `pull_request` runs for pull requests opened with `GITHUB_TOKEN` | Expected. The merge does not depend on it: the pull request settles at `UNSTABLE`, which a ruleset permits. Approve the run to clear the display if you like, but **never delete it** — that breaks the commit's check rollup in a way no re-run repairs, and the pull request becomes permanently unmergeable |
| A required check never fills on an agent's pull request | The workflow behind that context has no `workflow_dispatch` trigger | [Add `workflow_dispatch` to it](../pipeline/tasks/make-a-workflow-of-your-own-work-when-atomaton-starts-it.md), or drop that context — [which checks a ruleset may require](tasks/make-a-branch-ruleset-work-with-agents.md#require-only-checks-that-workflow_dispatch-can-start) |

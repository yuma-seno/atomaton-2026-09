# Make a workflow of your own work when Atomaton starts it

Add `workflow_dispatch` to its triggers, keeping the ones you have:

```yaml
on:
  pull_request:      # keep it — this is what serves humans and forks
  workflow_dispatch: # add it — this is how Atomaton runs the same workflow
```

Then stop reading the pull request out of the event. A `workflow_dispatch` run has no
`github.event.pull_request`, so a step that takes the PR number or its diff from the
event payload gets nothing when Atomaton starts it. Resolve it from the branch instead:

```bash
PR=$(gh pr list --head "$GITHUB_REF_NAME" --state open --json number --jq '.[0].number // empty')
```

Setting a branch ruleset up for the first time is [docs/setup.md](../../setup.md). The
`action_required` run that sits pending on an agent's pull request, and why deleting it
is destructive, is [docs/operations.md](../../operations.md).

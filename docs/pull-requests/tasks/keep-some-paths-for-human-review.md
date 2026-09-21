# Keep some paths for human review

Add the paths to `merge.governed_paths`:

```yaml
merge:
  governed_paths:
    - ".github/**"
    - "db/migrations/**"
```

An agent will not merge a pull request that touches one. It reviews it and reports, and
the merge is yours.

`.github/**` is covered by default, because that is where an agent's limits live — which
credentials reach a run, the scripts the runner executes to decide when a run may
continue, which commands the shell hook refuses, what a ruleset requires before a merge.
An agent that could merge a change to them could widen its own reach, and nothing later
catches it, because the next run already obeys the new file.

For a condition that a path cannot express — a label, a title, how many files changed —
use `merge.gates`, in [the pull request reference](../reference.md#mergegates).

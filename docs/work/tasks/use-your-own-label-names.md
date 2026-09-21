# Use your own label names

```yaml
chain:
  labels:
    in_progress: atomaton/in-progress
    sub_issue: atomaton/sub-issue
    launched: atomaton/launched
```

Change these only on a name collision with your own taxonomy. They are created on first
use. Why they sit under `chain`, and why they are not the labels a `merge.gates`
condition matches, is in [`chain.labels`](../reference.md#chainlabels).

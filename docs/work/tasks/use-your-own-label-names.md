# Use your own label names

```yaml
chain:
  labels:
    in_progress: atomaton/in-progress
    sub_issue: atomaton/sub-issue
    launched: atomaton/launched
```

Change these only on a name collision with your own taxonomy — they are state one run
leaves for the next to read rather than presentation, which is why they sit under
`chain`. They are created on first use, and they are not the labels a `merge.gates`
condition matches, which are labels a person applies. See
[docs/configuration.md](../../configuration.md).

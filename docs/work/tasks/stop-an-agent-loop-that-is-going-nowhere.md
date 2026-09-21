# Stop an agent loop that is going nowhere

Two bounds, counting different things:

```yaml
chain:
  after_handoffs: 5                 # handoffs with nobody else commenting
  after_runs_without_change: 2      # runs that pushed, opened and merged nothing
```

`after_handoffs` is the one for an engineer/reviewer exchange that keeps trading the
work; a person joining the thread resets it. `after_runs_without_change` catches the
other shape — runs that keep happening and change nothing — which a handoff count does
not see. What you are shown when either limit fires, and how to resume afterwards, is in
[docs/operations.md](../../operations.md).

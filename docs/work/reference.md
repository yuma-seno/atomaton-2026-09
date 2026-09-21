# Where work branches from, and when a chain stops

## `base_branch`

Where agent branches start from and where their pull requests target. Empty means
the repository's default branch, which is almost always right — a repository
developing on `main` wants exactly that.

Set it if you develop on an integration branch and release by merging that branch
elsewhere — `develop` → `main`, say. Without it every agent pull request aims at
`main`, so ordinary work lands straight in what you release from.

## `chain.after_handoffs`

```yaml
chain:
  after_handoffs: 5
```

How many agent-to-agent handoffs may happen with nobody else commenting. A person
joining the thread resets it.

Five is the default. `0` means the default rather than "no handoffs"; `1` is how
you say that an agent finishes its own turn and hands off to nobody. Five is
chosen against a repository where a person intervenes often, so
[running autonomously you will want a larger number](how-it-works/why-there-are-two-counters.md).

## `chain.after_runs_without_change`

```yaml
chain:
  after_runs_without_change: 2
```

How many consecutive runs may push no commit, open no pull request and merge
none. Two is the default: one run that changes nothing is ordinary — an agent
asked a question, or investigated and reported. `0` means the default.

It fires sooner than `after_handoffs` on repetition, and never on a long piece of
real work, because [length is not what it measures](how-it-works/why-there-are-two-counters.md).

How both counters are counted, what you see when either fires, and how to resume
are in
[what bounds a chain of runs](boundaries.md#what-bounds-a-chain-of-runs).

## `chain.labels`

```yaml
chain:
  labels:
    in_progress: atomaton/in-progress
    sub_issue: atomaton/sub-issue
    launched: atomaton/launched
```

Three names, and they are the ones Atomaton reads: `in_progress` while a run
holds an issue, `launched` once it has handed work on, and `sub_issue` on the
issues it opened. They are created on first use. What each one means to the
machinery that reads it is in
[the labels Atomaton applies](how-it-works/the-labels-atomaton-applies.md).

They are in this section rather than somewhere presentational because that is
what the labels are for: state one run leaves for the next to read. They are not
`merge.gates[].when.labels`, which are labels a **person** applies to a pull
request. Change these only on a name collision —
[use your own label names](tasks/use-your-own-label-names.md).

This level accepts names of your own, so a misspelling here is not caught by the
check that reads your config.

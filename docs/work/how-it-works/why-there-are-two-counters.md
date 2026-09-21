# Why there are two counters

An agent finishing its turn can name the next one, and that one can name another.
Left alone, an engineer and a reviewer will pass a pull request back and forth for
as long as each keeps finding something. `chain.after_handoffs` is where that
stops and a person is asked.

Its default is chosen against a repository where a person intervenes often — the
longest chain measured here was three — so running autonomously you will want a
larger number, and wanting closer supervision a smaller one.

`chain.after_runs_without_change` counts something else, and it is the thing
actually worth stopping. **A count of runs is a poor proxy in both directions.**
One piece of work here spent 2,299k tokens and finished; a loop going nowhere can
spend 30k and finish nothing. Cutting on how much happened stops the large
legitimate job and lets the small useless one run. So a run that pushed no
commit, opened no pull request and merged none is recorded as having changed
nothing, and a run of those in a row stops the chain.

Both are counted from comments rather than from anything stored, which is why a
re-dispatch, a new workflow run or a lost session does not reset either — see
[what bounds a chain of runs](../boundaries.md#what-bounds-a-chain-of-runs).

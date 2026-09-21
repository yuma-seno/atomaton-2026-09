# What bounds a run, and who may start one

## Who may start one

**An agent only starts when a repository member triggered it.** Outside
contributors can open issues, comment and raise pull requests freely; none of it
dispatches an agent, so no untrusted instruction reaches one and no model budget
is spent. Every routing workflow fires on a human action and checks the actor's
association — `OWNER`, `MEMBER` or `COLLABORATOR` — and agents reach the runner
through `workflow_dispatch` instead, which no outside contributor can invoke. That
covers the whole untrusted surface.

The workflows themselves hold `GITHUB_TOKEN` and the write scopes they declare,
which is what they mutate issues, pull requests and workflow dispatches with.
`atomaton-pr-merged.yml` is the one that listens rather than being dispatched, and
it listens with `pull_request_target`, which executes in the base repository's
context: review that trust model before extending it to anything wider than
detecting a merge.

What an agent's *tools* can and cannot reach is a different boundary —
[what a tool can and cannot be protected from](../tools/boundaries.md#what-a-tool-can-and-cannot-be-protected-from).

## What bounds a run

Not configurable, on purpose. The runner gives an agent whatever is left of the
60-minute job it runs inside, minus five minutes for what follows it — saving the
session, posting the result, dispatching whatever comes next. A run that stops on
that budget saves its session and can be continued with `/<agent>`; a run killed by
the job's timeout reaches none of those steps and its work is gone. There is no
ceiling on turns, and a new run gets a fresh budget.

A number in `config.yaml` could not have said that. It would have been a guess about
how long the checkout, the container build and the environment setup take on the
day, and a guess that was too large would be silently ignored by the job timeout.

## What bounds a chain of runs

Validation hands a pull request back to the engineer at most three times, and two
counters stop the chain itself — `chain.after_handoffs`, and
`chain.after_runs_without_change` when the runs stop changing anything. Both
defaults are in [the work reference](reference.md); neither is repeated here, so
this page cannot go stale against them, and
[why there are two](how-it-works/why-there-are-two-counters.md) is a question of
its own.

**There is no token or cost ceiling**: the bounds are on how many runs happen, not
on what they spend.

When a limit is hit, the run still finishes and still reports. Only the handoff is
withheld, and a comment says which limit stopped it and which agent would have run
next. Posting `/<agent>` resumes it.

`chain.after_runs_without_change` is counted from the comments, like the handoff
limit, so nothing is stored: each result comment records what its run did.
**Anything else in the thread ends the count** — a person's comment, a notice from
the machinery, or a run that did change something. That is deliberate, and it makes
this under-fire rather than over-fire: a run that ends by opening a pull request
posts no result comment of its own, so its progress is invisible to this count and
the runs either side of it must not read as consecutive.

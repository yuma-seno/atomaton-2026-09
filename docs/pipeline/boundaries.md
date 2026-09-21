# What a check and a deployment refuse to do

## A check that needs a credential

**`checks.from_pull_request` has no `secrets`, and cannot.** The commands there
are the pull request's own, run in its own tree, so a credential named for them
would be a credential the change being judged can read — a pull request may
rewrite any command it declares. A check that needs one goes in the other half.
The values stay in GitHub either way; only the names are ever in the config.

Three things differ in `checks.from_default_branch`, and they are why a
credential is safe there.

**The commands come from the default branch.** A pull request cannot change what
runs, add a job, or widen which secret a job receives —
[which ref a pipeline is read from](how-it-works.md).

**The pull request arrives as data.** `$ATOMATON_PR_TREE` is a path to a checkout
of it. Read it; do not execute it. That is the same rule the check on the
deliverable holds itself to, and nothing mechanical enforces it here — an
interpreter reads a file rather than executing it, so no filesystem flag will
stop `bash "$ATOMATON_PR_TREE/x.sh"`. It rests on review, which is why this list
is meant to stay short.

**Each job names its own secrets.** A job is handed the ones its own entry named
and no others, so a staging credential does not sit in the job that checks
something else.

What you cannot write is a pull request's own command holding a credential. There
is no spelling for it: one half has no `secrets` key and the other takes no
commands from the pull request. A check that genuinely needs both — integration
tests against a real environment, say — belongs after the merge, or wants a
credential you would not mind losing.

The other direction is worth knowing: a tool that needs a credential you would
rather not route into an agent's environment can be a step in
`checks.from_pull_request` instead, because that list runs in its own job. What
routing does and does not protect is in
[docs/operations.md](../operations.md#what-a-tool-can-and-cannot-be-protected-from).

## A deployment refuses a branch anyone can push to

A branch anyone can push to is a deployment anyone can run, with its credentials,
on a commit nobody read. So before a deployment starts, the branch its entry
named is checked against the rulesets in effect on it, and the run is **refused**
— not warned — when no ruleset requires a pull request there. The shipped ruleset
covers `~DEFAULT_BRANCH` and nothing else, so `branches: [develop]` needs one of
your own covering `develop`.

A refusal is also what you get when the rules could not be read at all, and on a
repository where rulesets are unavailable — a private repository on a free plan.
"Could not be checked" is not "is protected", and a deployment is not the place to
guess. What is left on such a repository is
[what `merge` decides](../pull-requests/boundaries.md), which is then the whole of
the gate.

`on_merge` and `on_tag` are both checked this way, because both name a branch.
`on_demand` is not: it answers to no event, so reaching it already took someone
with write access naming it by hand.

**A tag is checked twice, and the second one is the point.** Its entry's
`branches` must require a pull request, *and* the tag's commit must actually be
inside one of them. Measured: `compare/main...v1.0.0` answers `behind` when the
commit is in `main` and `diverged` when it is not.

A tag that matches your pattern but sits outside the branch deploys nothing, and
says so in the log — it is not an error, because tagging something that is not
ready is an ordinary thing to do. What it is not is silent.

## What commands cannot express

Where you still need a workflow of your own, through `deploy.your_workflow` or
`checks.your_workflow`:

- a job's `permissions` beyond what the shipped workflows declare.
  `atomaton-check.yml` runs with `contents: read` plus a `GITHUB_TOKEN` in
  `GH_TOKEN`; `atomaton-deploy.yml` with `contents: write` and `id-token: write`,
  so it can cut a release and can exchange its identity for cloud credentials
- a deployment approval gate — `environment:` takes no expression, so nothing in
  configuration can reach it
- GitHub's own artifact store and cache
- any trigger outside merge, tag and manual dispatch — including a schedule,
  since a cron expression can only be written in a workflow's `on:`, and
  including a default branch named neither `main` nor `master`, for your own
  merges

Most of the limits people expect are not real. Service containers work through
`docker run`, and a matrix works as a loop, losing only parallelism. Both are
commands.

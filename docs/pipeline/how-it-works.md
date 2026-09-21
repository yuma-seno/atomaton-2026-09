# Which ref a pipeline is read from

**What runs is read from your default branch**, not from the branch, the tag or
the pull request being worked on. The workflow starts for a push to any ref — it
has to, or you could not deploy from `develop` — so the ref that starts a run
must not also be the ref that says what that run may do and which secrets it
holds.

Your commands still operate on the tree being deployed or reviewed. Only the
declaration comes from the branch a person approved.

That one rule is what `checks.from_default_branch`, the credentials on a deploy
entry, `merge.gates` and `tools.secrets` all rest on: a pull request can change
what a run *does* — that is the change under test — but not which of your secrets
it is handed, and not the gate that is judging it. Adding a name therefore takes
effect once it is merged, not while the pull request that adds it is being
reviewed.

The one thing read from the pull request is the pull request's own
`.github/atomaton/`, by the check whose whole question is whether that tree could
still start a run. It reads it as data and starts nothing —
[what a pull request is checked against](../operations.md#what-a-pull-request-is-checked-against).

## What an agent's own merge does not start

An agent merges with `GITHUB_TOKEN`, and
[GitHub raises no event for its own token](../operations.md#github-raises-no-event-for-its-own-token).
So nothing downstream of that merge fires by itself: a deployment chained off a
push to the base branch, or off your CI, would silently never run. That is what
`deploy.your_workflow` exists to be dispatched as.

**A tag your own deployment creates starts `on_tag` too**, and it has to be
arranged rather than inherited. A deployment that cuts a release creates its tag
with the run's own token, so `on_tag` would fire for a tag you pushed by hand and
never for the one your release made. The run that created it dispatches, once per
new tag. A run that was itself started by a tag does not, or a deployment that
tags would start itself forever.

## Ordering, and what a merge makes reachable

Deployments run **one at a time, in declared order**, and the first failure stops
the rest: with one deployment already broken, continuing puts more of your estate
in an unknown state rather than less.

A push nothing claimed deploys nothing and stays green, so tagging and pushing
for other reasons costs you a few seconds and no red run.

**A merge deploys the tags it just made reachable.** Tag a commit on a branch,
merge the branch, and the tag now points inside the protected one though no tag
was ever pushed. The merge's own event carries both ends of what arrived, so that
tag deploys at the moment its commit becomes reviewed — with nothing anywhere
holding a list of tags waiting their turn. Note that a **squash** merge writes a
new commit, so a tag on the branch's own commits never becomes reachable that
way: tag what you merged, or merge without squashing.

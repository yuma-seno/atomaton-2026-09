# Make a branch ruleset work with agents

Nothing will tell you if you skip this, and
[nothing could](../boundaries.md#no-job-can-apply-a-branch-ruleset-and-none-can-report-that-it-was-not-applied).

A ruleset that requires a status check is the normal way to keep unreviewed work
off your default branch, and it is worth keeping. It applies to agents exactly as
it applies to you — nothing here asks you to exempt them. Three things make it
work.

## Apply `.github/atomaton/rulesets/main.json`

**From the web UI** — easiest, and needs nothing installed:

> Settings > Rules > Rulesets > *New ruleset* > **Import a ruleset**, then upload
> `.github/atomaton/rulesets/main.json`.

**From a shell** — if you already have an admin-scoped `gh` login:

```bash
gh api --method POST repos/{owner}/{repo}/rulesets \
  --input .github/atomaton/rulesets/main.json
```

If the import option is unavailable, create it through the form instead and set:
target the default branch; restrict deletions; block force pushes; require a pull
request with **0** required approvals; and require the `atomaton-check` status
check. Leave the bypass list empty.

To change the rules later, edit the JSON in a pull request, then re-import (or
`gh api --method PUT repos/{owner}/{repo}/rulesets/{id} --input ...`). Nothing
detects a ruleset edited in the UI without a matching change to the file, so
keeping the two together is a discipline rather than something enforced.

## Set required approving reviews to 0

Atomaton's agents share one bot identity and GitHub forbids self-approval, so
requiring even one review deadlocks every agent pull request. The shipped file
already declares `required_approving_review_count: 0`; set it yourself if you
write your own ruleset rather than importing that one.

## Require only checks that `workflow_dispatch` can start

Atomaton starts the workflow behind a required check itself for an agent's pull
request, waits for it, and publishes the result. A workflow it cannot start
leaves the check unfilled, and the pull request can never merge.

The shipped `atomaton-check.yml` already accepts `workflow_dispatch`. A workflow
of your own needs the trigger added — [make a workflow of your own work when
Atomaton starts
it](../../pipeline/tasks/make-a-workflow-of-your-own-work-when-atomaton-starts-it.md).
Contexts that come from somewhere else — a coverage service, a scanner, a
workflow written for `pull_request` alone — cannot be filled on an agent's pull
request at all. Drop those from the ruleset's required list.

Keep the two names in step. `.github/atomaton/rulesets/main.json` ships requiring
the context `atomaton-check`, which is the job name in `atomaton-check.yml`;
renaming one side without the other does not fail a pull request — it leaves it
waiting forever on a check that will never report, and re-running nothing fixes
it. That is [a required check that never
fills](../when-it-breaks.md).

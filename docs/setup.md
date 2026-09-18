# Setup

For somebody putting Atomaton into a repository for the first time. Everything on this
page is work to do, in the order to do it; getting the deliverable into the tree is
the step before it, in [the README](../README.md).

## 1. Enable GitHub Actions in the target repository

Every entry point is a workflow. Nothing dispatches an agent until Actions is on.

## 2. Allow Actions to create pull requests

Open **Settings > Actions > General > Workflow permissions** and enable **Allow
GitHub Actions to create and approve pull requests**. Without this repository-level
permission, the engineer agent cannot create pull requests.

The generated workflows already declare their own `permissions` — `actions`,
`issues`, `pull-requests` and `contents` set to write where needed — and those do
**not** override the repository-level setting. A workflow cannot grant itself what
the repository withholds, so reading the declared block is not evidence that this
step is done.

## 3. Add the repository secret `ORCAROUTER_API_KEY`

**Settings > Secrets and variables > Actions > New repository secret**, named
`ORCAROUTER_API_KEY`. This is the one the shipped configuration needs: all three
agent definitions read `provider: orcarouter-responses`.

One provider, one credential, and **no fallback** — a key under a different name does
not stand in for this one, and two keys present is an error naming both rather than a
precedence that picks for you. To run somewhere else, change `provider` in the agent
definitions and add that provider's own secret; the eight values and the credential
each reads are in [docs/configuration.md](configuration.md).

## 4. Put your install and build commands in `environment.setup_commands`

In `.github/atomaton/config.yaml`:

```yaml
environment:
  setup_commands:
    - "bun install --frozen-lockfile"
```

They run through `bash -c`, in order, and stop on first failure — before the agent
starts, before `checks.atomaton_runs.commands`, and before `deploy.atomaton_runs.targets`.
One declaration, three jobs.

The template ships this empty on purpose: it is language- and framework-agnostic, and
only you know what your project needs. Agents are told to treat the runner as already
provisioned and never to spend iterations installing tooling themselves, so anything
they need at run time belongs here.

## 5. If you use a branch ruleset

A branch ruleset that requires a status check is the normal way to keep unreviewed
work off your default branch, and it is worth keeping. It applies to agents exactly
as it applies to you — nothing here asks you to exempt them. Three things make it
work.

### Apply `.github/atomaton/rulesets/main.json` by hand

A ruleset is **not** read from the repository. It is a server-side setting, and the
file that ships with the deliverable is this project's convention: the reviewed
declaration of what the setting should be. Something has to carry it across.

CI cannot. Creating or updating a ruleset goes through the repository administration
API, and `administration` is not a permission a workflow can grant `GITHUB_TOKEN`.
So applying it is a deliberate act by someone with admin — and **nothing will tell
you if you skip it.** A check could only report, never enforce: if the ruleset were
missing then `atomaton-check` would no longer be a required context either, so a failing
check would block nothing.

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
request with **0** required approvals; and require the `atomaton-check` status check.
Leave the bypass list empty.

To change the rules later, edit the JSON in a pull request, then re-import (or
`gh api --method PUT repos/{owner}/{repo}/rulesets/{id} --input ...`). Nothing
detects a ruleset edited in the UI without a matching change to the file, so keeping
the two together is a discipline rather than something enforced.

### Set required approving reviews to 0

Atomaton's agents share one bot identity and GitHub forbids self-approval, so requiring
even one review deadlocks every agent pull request. The shipped file already declares
`required_approving_review_count: 0`; set it yourself if you write your own ruleset
rather than importing that one.

### Require only checks that `workflow_dispatch` can start

Atomaton starts the workflow behind a required check itself for an agent's pull request,
waits for it, and publishes the result. A workflow it cannot start leaves the check
unfilled, and the pull request can never merge.

The shipped `atomaton-check.yml` already accepts `workflow_dispatch`. For a workflow of
your own, keep whatever triggers you have and add that one:

```yaml
on:
  pull_request:      # keep it — this is what serves humans and forks
  workflow_dispatch: # add it — this is how Atomaton runs the same workflow
```

Contexts that come from somewhere else — a coverage service, a scanner, a workflow
written for `pull_request` alone — cannot be filled on an agent's pull request.
Either drop them from the ruleset's required list or give them a `workflow_dispatch`
trigger too.

Keep the two names in step. `.github/atomaton/rulesets/main.json` ships requiring the
context `atomaton-check`, which is the job name in `atomaton-check.yml`; renaming one side
without the other does not fail a pull request — it leaves it waiting forever on a
check that will never report, and re-running nothing fixes it.

## 6. Pin the version you adopted

`latest` is the convenient path. Name a version instead when you want to know what
you adopted and diff it later:

```bash
gh release download v0.1.115 -R yuma-seno/atomaton -p atomaton-delivery.zip
unzip -o atomaton-delivery.zip   # the archive holds .github/, so run this at the repo root
rm atomaton-delivery.zip
```

Record which one you took. Moving to a newer release is vendoring rather than
installing, and the procedure is in [docs/recipes.md](recipes.md).

## 7. Open the first issue

The command is a bare agent name on a line of its own, and it must be the first
visible line of the body. The request goes on the lines after it:

```text
/orchestrator

Build a plan to split this task into sub-issues.
```

Text after the agent name on the command line is rejected rather than guessed at, so
`/engineer implement the parser` reads as valid and starts nothing. Blank lines and
HTML comments before the command are skipped; ordinary prose is not, because a
command below a paragraph is not a command at the top.

The shipped agents are `orchestrator`, `engineer` and `reviewer`. What happens next,
and how to read it, is [docs/operations.md](operations.md).

---
name: delivery/pipeline-setup
description: Load when this repository has no automated verification or deployment and the work needs one — written into config.yaml rather than into workflow files.
---

# Setting up verification and deployment

Read this when a repository has no automated verification or no deployment and
the work in front of you needs one. Not a procedure to follow on request — a
description of how this is arranged here, because the obvious approach does not
work.

## You cannot write a workflow. You do not need to.

`GITHUB_TOKEN` is refused on `.github/workflows/**`. Not by a rule someone set —
by identity, on every path, on every branch, through `git push` and through the
API alike. There is no permission that grants it. Do not try, and do not ask a
person to paste a workflow file for you.

Everything a pipeline actually *does* is a command, and commands go in
`.github/atoma/config.yaml`, which you can write. Two workflows that already ship
run them.

## The environment

What the project needs *installed* is separate from what verifies it:

```yaml
environment:
  setup_commands:
    - bun install --frozen-lockfile
```

Write it here once and every job runs it: the agent's own shell, the checks, and
the deployment. That is the point of the separate block. Putting `bun install` at
the front of `checks.atoma_runs.commands` instead looks equivalent and is not —
the agent's shell then has the dependencies and CI installs them again, or the
reverse, and the two environments drift. A test that passes for the agent and
fails in CI comes back to an engineer as a defect that does not reproduce.

System packages belong here too, and only here. An agent cannot install one during
a run.

## Verification

`checks` has two arms and takes exactly one. Fill in `atoma_runs` and the shipped
workflow runs your commands:

```yaml
checks:
  atoma_runs:
    commands:
      - bun run typecheck
      - bun test
```

They run in order in `atoma-check.yml`, after the environment setup above, and the
first failure ends the run.
Whatever a contributor would type to check the project locally is what belongs
here — read the README, the package manifest's scripts, and any CONTRIBUTING
file before writing this, rather than guessing a stack.

**If `checks.your_workflow` already names a workflow, that one is correct.** A
repository with its own CI has it for reasons that are not in front of you. Leave
both alone, and in particular do not add `atoma_runs` beside it: a section
carrying both arms is reported as a configuration error rather than resolved by a
precedence rule, so the change comes back rejected instead of half-applied.

## Deployment

The same two arms, and the same rule — `deploy.atoma_runs.targets`, or
`deploy.your_workflow`, never both.

```yaml
deploy:
  atoma_runs:
    targets:
      - name: staging
        on: merge
        commands: ["./scripts/deploy.sh staging"]
      - name: production
        on: tag
        tags: ["v*"]
        commands: ["./scripts/deploy.sh prod"]
```

`on` is `merge` (after a pull request lands), `tag` (a pushed tag matching
`tags`), or `manual` (only when someone dispatches it by name). A tag pattern is
a literal or a prefix followed by `*`. Every target can also be dispatched by
name whatever its trigger, which is what makes a `manual` rollback target useful.

`$ATOMA_DEPLOY_TARGET` holds the target's name inside its commands.

## Credentials

Never write a credential into `config.yaml` or into a command. Both are committed
in plain text.

A secret is added to the repository by a person, and then *named* in the list for
the place that needs it:

```yaml
checks:
  atoma_runs:
    secrets: ["NPM_TOKEN"]
deploy:
  atoma_runs:
    secrets: ["AWS_ROLE_ARN"]
```

It arrives as an environment variable under that name. The three lists —
`checks.atoma_runs.secrets`, `deploy.atoma_runs.secrets` and `tools.secrets` —
are separate on purpose and must not be merged: each reaches only its own
destination, and the nesting is what says so.

**`tools.secrets` needs a second step, and the others do not.** Naming a secret
there authorises the run to hold it; it does not deliver it to any tool. The tool
that needs it must also name it in its own `env`, which is written under
`tools.servers` in the same file:

```yaml
tools:
  secrets: ["SLACK_TOKEN"]
  servers:
    slack:
      command: mcp-server-slack
      env:
        SLACK_TOKEN: "${SLACK_TOKEN}"
```

`tools.servers` is empty in a fresh config and is **additive**: it holds servers a
project adds, and overrides of the ones Atoma ships. `slack` above is an addition,
so it declares the server in full, starting with the `command` that starts it.

**To route a credential to a server Atoma ships** — `shell`, `github`, `web`,
`search`, `atoma`, `atoma_env`, `filesystem`, `filesystem_readonly` — write its
name with an `env` and nothing else. A shipped name is merged field by field, so
the command, the hooks and the timeout stay as they ship:

```yaml
tools:
  servers:
    <the shipped server's name>:
      env:
        API_TOKEN: "${API_TOKEN}"
```

Do not reconstruct the rest of a shipped entry to do this. You cannot read it in
`config.yaml` — it is not there — and a copied `command` or `args` freezes that
server at today's values, so the next upgrade moves nothing you pasted.

A reference, never a value. Every tool that does not name it — including `shell` —
cannot see it, and that is deliberate rather than a gap to fix. If a tool reports
a missing credential, the question is whether that server's `env` names it: for a
shipped server, an empty `tools.servers` means it was never routed, and that is
the answer rather than a sign something is missing from the file.

`config.yaml` is the only place this goes. There is no tools file in the
repository: the one `atoma` is handed is written at the start of each run, from
the shipped servers and whatever `tools.servers` adds, and deleted with the
runner. If you find a `tools/tools.yaml` left behind by an older release, it is
read by nothing — routing a credential through it produces a tool that never
receives it, with nothing reporting why.

`checks` and `deploy` need no routing step: their commands run in a workflow of
their own rather than beside an agent.

**Do not invent a secret name and hope.** If a deployment needs a credential you
cannot see, say so in your report and name exactly which one — a person adds it
and tells you what they called it. A guessed name produces a run that warns, then
fails somewhere unrelated.

**A name you add does not take effect until it is merged.** These lists are read
from the default branch, not from the branch a run is working on, so a credential
you declare will not be present in the run reviewing your own pull request. That
is intended. Do not conclude the mechanism is broken and work around it, and do
not try to test it by reading the value — say in your report which secret the
work now needs.

Prefer no credential at all where the platform allows it. `atoma-deploy.yml`
declares `id-token: write`, so a cloud provider's OIDC login is available and is
better than any long-lived key.

## What commands cannot express

Reach for a person, not a workaround, when you need:

- a job's `permissions` beyond what the shipped workflows declare. Checks get
  `contents: read` and a `GITHUB_TOKEN` in `GH_TOKEN`, so `gh` works. Deployments
  get `contents: write` and `id-token: write`, so cutting a release and an OIDC
  login both work
- a deployment approval gate (`environment:`) — `environment:` takes no
  expression, so configuration cannot reach it
- a trigger outside merge, tag and manual dispatch — schedules in particular
  cannot come from configuration
- GitHub's own artifact store or cache

Most limits people assume are here are not. Service containers work through
`docker run`. A matrix works as a loop, losing only parallelism. Those are
commands; write them.

## The required check

If a ruleset requires a status check, its `context` must equal the job name that
produces it. `.github/atoma/rulesets/main.json` ships already matched to
`atoma-check.yml`. **Do not edit either side to make them agree** — a mismatch
does not fail a pull request, it leaves it waiting forever on a check that will
never report, and no amount of re-running fixes it. If they appear mismatched,
report it.

## Finishing

Changing `.github/atoma/config.yaml` is a governed change: you may write it and
open the pull request, and a person merges it. That is expected, not an
obstruction. Say plainly in the pull request what will now run, on which events,
and which secrets a person still has to add.

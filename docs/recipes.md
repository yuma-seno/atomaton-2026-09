# Recipes

For somebody who already has Atoma running and wants it to do one specific thing.

Each entry is the goal, the smallest change that reaches it, and a pointer. What a
setting means, what else it accepts and why it defaults the way it does belongs in
[docs/configuration.md](configuration.md); this page is the index from a goal to the
line you edit.

## Contents

| You want to | What you change |
| --- | --- |
| [run an agent on a different model](#run-an-agent-on-a-different-model) | `model`, in an agent definition |
| [have a screenshot reach an agent as a picture](#have-a-screenshot-reach-an-agent-as-a-picture) | `vision`, in an agent definition |
| [switch between the Chat Completions and Responses APIs](#switch-between-the-chat-completions-and-responses-apis) | `provider`, in an agent definition |
| [reach a provider the table does not list](#reach-a-provider-the-table-does-not-list) | the `OPENAI_BASE_URL` repository variable |
| [prefer particular upstream providers](#prefer-particular-upstream-providers) | `extra_body`, in an agent definition |
| [give a repository a pipeline an agent can write and maintain](#give-a-repository-a-pipeline-an-agent-can-write-and-maintain) | `checks.atoma_runs` and `deploy.atoma_runs` |
| [have agents start your own CI and deployment](#have-agents-start-your-own-ci-and-deployment) | `checks.your_workflow` and `deploy.your_workflow` |
| [make a workflow of your own work when Atoma starts it](#make-a-workflow-of-your-own-work-when-atoma-starts-it) | `workflow_dispatch`, in that workflow |
| [check your config before pushing it](#check-your-config-before-pushing-it) | nothing — one command |
| [keep some paths for human review](#keep-some-paths-for-human-review) | `merge.governed_paths` |
| [let agents merge their own pull requests](#let-agents-merge-their-own-pull-requests) | `merge.policy` |
| [stop an agent loop that is going nowhere](#stop-an-agent-loop-that-is-going-nowhere) | `chain.after_handoffs`, `chain.after_runs_without_change` |
| [use your own label names](#use-your-own-label-names) | `chain.labels` |
| [let a tool server reach something outside GitHub](#let-a-tool-server-reach-something-outside-github) | `tools.secrets`, then that server's own environment |
| [let a tool run longer than a minute](#let-a-tool-run-longer-than-a-minute) | `request_timeout_secs`, on that server |
| [change or remove web fetching and search](#change-or-remove-web-fetching-and-search) | the `research/web-search` skill |
| [move to a newer release](#move-to-a-newer-release) | nothing — a vendoring procedure |
| [have something happen every week](#have-something-happen-every-week) | a workflow you copy in |

## Agents

### Run an agent on a different model

Edit `.github/atoma/agent-definitions/<agent>.md` and change the frontmatter `model`
field.

Revisit `extra_body` at the same time — the endpoint names it lists are per-model.
See [prefer particular upstream providers](#prefer-particular-upstream-providers).
The rest of the frontmatter an agent definition accepts is in
[docs/configuration.md](configuration.md).

### Have a screenshot reach an agent as a picture

An agent gets pictures from a tool only when its definition says so:

```yaml
vision: true
```

Check the model first. On OpenRouter:

```bash
curl -s https://openrouter.ai/api/v1/models/<author>/<slug>/endpoints \
  | grep -o '"input_modalities":\[[^]]*\]'
```

Leaving it off loses nothing silently: a tool that returns a picture delivers text in
its place saying the image was withheld and naming this setting. Setting it on a model
that cannot read images is the expensive mistake — an API error that loses the run.

The shipped agents are set this way: the reviewer and orchestrator read images, the
engineer does not. [docs/configuration.md](configuration.md) has the default and why
it is that way round.

### Switch between the Chat Completions and Responses APIs

The frontmatter `provider` field selects the client, not the vendor. Each vendor has a
pair: `openai` and `openai-responses`, `openrouter` and `openrouter-responses`, and so
on.

**Prefer the Chat Completions member of the pair.** It is what vLLM, Ollama, LM Studio,
Azure and every gateway built to that shape accept, so it is the one that keeps your
choice of host open.

The Responses variants earn their place in one case — **a tool that returns an image**.
Chat Completions cannot carry a picture in a tool result at all, so on that route the
image is moved into a following message; the Responses API's `function_call_output`
takes it directly. If your agents never receive pictures, the two behave alike.

The eight values, the credential each reads and the endpoint each defaults to are the
provider table in [docs/configuration.md](configuration.md).

### Reach a provider the table does not list

Set `provider: openai` and point the `OPENAI_BASE_URL` repository variable at any host
serving the endpoint you picked — not every OpenAI-compatible gateway implements
`/responses`.

What you give up by doing that instead of naming a provider is that the run's log says
`openai`, so where it went is only visible in the variable. **This repository's own
agent definitions were that case**, reading `provider: openai-responses # openrouter`
— and the trailing comment was there because the name did not say where the request
went. They name `openrouter-responses` now.

Each endpoint moves with its own `*_BASE_URL` variable (`OPENROUTER_BASE_URL` and so
on), and it is a repository variable rather than a secret. None of them may be declared
in `tools.secrets`: moving a provider's endpoint is a way to send its credential
somewhere else.

### Prefer particular upstream providers

On OpenRouter. Agent definitions ship an `extra_body` block, and Atoma merges every
key in it straight into the request body, so this is OpenRouter's own provider-routing
contract rather than an Atoma feature:

```yaml
extra_body:
  provider:
    order:
      - Xiaomi
      - Parasail
      - Novita
```

`order` puts the endpoints with the best uptime first, while OpenRouter stays free to
route elsewhere. Note that this nested `provider:` is unrelated to the top-level one,
which selects Atoma's client.

**Do not add `allow_fallbacks: false` or `require_parameters: true`.** They look like
the natural way to make `order` binding, and they break every request as soon as any
provider-side tool is declared. Server tools are executed by OpenRouter above provider
selection, and no endpoint advertises them in `supported_parameters`, so hard-pinning
the route leaves that layer nowhere to dispatch: every run then fails on its first
inference call with `Server tool request failed` (HTTP 404, `provider_name: null`).
Keep this list advisory.

A single unhealthy endpoint shows up as hung requests, truncated response bodies, and
contentless completions. List the current endpoints and their uptime with:

```bash
curl -s https://openrouter.ai/api/v1/models/<author>/<slug>/endpoints
```

Adjust `order` whenever you change `model`, since the endpoint names are per-model.

## Checks and deployment

### Give a repository a pipeline an agent can write and maintain

Write no workflow. Describe the pipeline as commands in `config.yaml`:

```yaml
checks:
  atoma_runs:
    commands:
      - bun install --frozen-lockfile
      - bun run typecheck
      - bun test

deploy:
  atoma_runs:
    targets:
      - name: staging
        on: merge
        commands: ["./scripts/deploy.sh staging"]
```

Nothing needs pointing at these. `atoma-check.yml` and `atoma-deploy.yml` are what a
section runs when it names no workflow of your own; fill in the commands and they run.

This is the default arm because **an agent can write configuration and cannot write a
workflow.** GitHub refuses `GITHUB_TOKEN` on `.github/workflows/**` by identity, on
every path and every branch, and no permission grants it. So a repository whose pipeline
lives in `config.yaml` is one an agent can set up, extend and repair; one whose pipeline
lives in workflow YAML always needs a person.

The trigger kinds, where credentials go, and the four things commands cannot express are
in [docs/configuration.md](configuration.md).

### Have agents start your own CI and deployment

Most projects should not need this — it opts back out of the commands pipeline above.
Reach for it when the pipeline needs something commands cannot express.

```yaml
checks:
  your_workflow: ci.yml
deploy:
  your_workflow: deploy.yml
```

Name each file exactly as it is called, or the dispatch fails silently and every merge
is refused for a missing check. **Delete the `atoma_runs` block in the section you name
a workflow in.** The two are alternatives: declaring both fails the pull request's
check, naming the section, rather than resolving by a precedence rule.

Name `deploy.your_workflow` even when your deployment is already chained off CI or off a
push to the base branch. An agent merge is performed with `GITHUB_TOKEN`, and GitHub
starts no workflow run for events its own token triggers — see
[docs/operations.md](operations.md) — so nothing downstream of that merge fires by
itself and your deployment would silently never run.

What each arm means, and what the workflow you name has to support, is in
[docs/configuration.md](configuration.md).

### Make a workflow of your own work when Atoma starts it

Add `workflow_dispatch` to its triggers, keeping the ones you have:

```yaml
on:
  pull_request:      # keep it — this is what serves humans and forks
  workflow_dispatch: # add it — this is how Atoma runs the same workflow
```

Then stop reading the pull request out of the event. A `workflow_dispatch` run has no
`github.event.pull_request`, so a step that takes the PR number or its diff from the
event payload gets nothing when Atoma starts it. Resolve it from the branch instead:

```bash
PR=$(gh pr list --head "$GITHUB_REF_NAME" --state open --json number --jq '.[0].number // empty')
```

Setting a branch ruleset up for the first time is [docs/setup.md](setup.md). The
`action_required` run that sits pending on an agent's pull request, and why deleting it
is destructive, is [docs/operations.md](operations.md).

### Check your config before pushing it

```bash
bun run .github/atoma-runtime/scripts/validate_deliverable.ts --root .
```

The same check that runs as the required check on an agent's pull request, against a
checkout or a worktree instead. What it looks at — and what it deliberately leaves to
CI — is in [docs/operations.md](operations.md).

## Merging

### Keep some paths for human review

Add the paths to `merge.governed_paths`:

```yaml
merge:
  governed_paths:
    - ".github/**"
    - "db/migrations/**"
```

An agent will not merge a pull request that touches one. It reviews it and reports, and
the merge is yours.

`.github/**` is covered by default, because that is where an agent's limits live — which
credentials reach a run, the scripts the runner executes to decide when a run may
continue, which commands the shell hook refuses, what a ruleset requires before a merge.
An agent that could merge a change to them could widen its own reach, and nothing later
catches it, because the next run already obeys the new file.

For a condition that a path cannot express — a label, a title, how many files changed —
use `merge.gates`, in [docs/configuration.md](configuration.md).

### Let agents merge their own pull requests

```yaml
merge:
  policy: auto
```

`manual` is the shipped default and it means an agent never merges. `auto` means it may,
when nothing else objects — `merge.governed_paths`, `merge.gates` and whatever GitHub's
own ruleset requires all still apply, and any one of them firing puts the merge back in
a person's hands. How those members compose is in
[docs/configuration.md](configuration.md).

### Stop an agent loop that is going nowhere

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
[docs/operations.md](operations.md).

### Use your own label names

```yaml
chain:
  labels:
    in_progress: atoma/in-progress
    sub_issue: atoma/sub-issue
    launched: atoma/launched
```

Change these only on a name collision with your own taxonomy — they are state one run
leaves for the next to read rather than presentation, which is why they sit under
`chain`. They are created on first use, and they are not the labels a `merge.gates`
condition matches, which are labels a person applies. See
[docs/configuration.md](configuration.md).

## Tools

### Let a tool server reach something outside GitHub

A tool server that talks to something outside GitHub needs a credential — a Slack token,
an API key for your issue tracker. **Three steps, and each does a different job.** Doing
two of them and wondering why nothing arrives is the usual way to get this wrong.

**1. Add the secret to the repository**, the usual way, in Settings. Nothing in the
config creates a secret; the other two steps only refer to one.

**2. Authorise the run to hold it**, in `tools.secrets`:

```yaml
tools:
  secrets:
    - SLACK_TOKEN
```

This says the run may obtain that secret. It does not say which tool gets it — at this
point no tool can see it.

**3. Route it to the tool that needs it**, in that server's environment:

```yaml
tools:
  servers:
    slack:
      command: mcp-server-slack
      env:
        SLACK_TOKEN: "${SLACK_TOKEN}"
```

Now that one server receives it, under that name. **Every other tool still cannot see
it**, including the shell.

`slack` is a server of your own, so its entry declares it in full. Routing a credential
to one Atoma ships — `github`, `search`, `web` and the rest — is the same step with a
shorter entry: the server's name and an `env` alone. An entry for a shipped name is
merged into it field by field, so naming `env` changes only the environment and leaves
the command, the hooks and the timeout as they ship.

A server of your own also has to exist on the runner. `mcp-server-slack` is a program,
and nothing installs it unless you say so: name its package in `tools.packages`, which
is where a project declares what a server it added needs. The shipped servers' own
packages are in the deliverable and are not repeated there. See
[docs/configuration.md](configuration.md), under `tools.packages`.

Steps 2 and 3 are two keys in the same file, which does not make them one step:
authorising a credential does not deliver it. `checks` and `deploy` need no third step at
all, because their commands run in a workflow of their own rather than beside an agent —
a secret named in `checks.atoma_runs.secrets` is in that job's environment and there is
no server to route it to.

You never edit a workflow for any of this, and there is no tools file to edit: the one
`atoma` is handed is written at the start of each run — from the servers Atoma ships and
whatever `tools.servers` adds or overrides — and thrown away with the runner.
`config.yaml` is still the only place a credential is routed.

Why routing is required at all is in [docs/configuration.md](configuration.md); what it
does and does not protect you from is in [docs/operations.md](operations.md).

### Let a tool run longer than a minute

Atoma cuts off one tool call after 60 seconds. Say so in that server's entry under
`tools.servers`:

```yaml
tools:
  servers:
    my_tool:
      command: bun
      args: ["run", "./scripts/my_tool.ts"]
      request_timeout_secs: 600
```

For a server Atoma ships, write the same key under that server's name and nothing else.
An entry for a shipped name is an override merged field by field, so one line raises the
timeout and the argv, hooks and `env` stay as they ship:

```yaml
tools:
  servers:
    shell:
      request_timeout_secs: 7200
```

**A timeout argument in your tool's own schema does not raise this.** That is the trap,
and it is not hypothetical — it is how the shell server shipped. Its `shell_execute`
advertised `timeout_seconds` up to 3600 and defaulted to 300, so the agent was told it
could run a long build. Atoma cut the call off at 60, and the error named the server
rather than the limit.

**Do not raise it just in case.** This limit is the only thing that notices a server
which has stopped responding. A server that answers in milliseconds should keep the
default, so a hung one is reported in a minute rather than in however long seemed
generous. `0` means the default, the same as leaving it out.

If what is slow is a first call paying for a model, an index or a connection, move the
cost off the request before raising the limit. [docs/writing-a-tool.md](writing-a-tool.md)
has how, and what a server must do when a call is abandoned.

### Change or remove web fetching and search

Searching is a skill rather than a tool.
`.github/atoma/skills/research/web-search.md` tells agents to fetch a search engine's
results page and read the links out of it. The endpoint lives in that file on purpose:

- To use a different service — one with an API key, or your own instance — edit the
  skill. The tool fetches whatever URL it is handed, so nothing else changes.
- To stop agents querying a public search engine at all, delete that section of the
  skill. Fetching a page whose address is already known keeps working.
- To remove web access entirely, drop `web` from `mcp_servers` in the agent definitions
  that name it. That is the whole of it, and there is nothing to delete in
  `config.yaml`: `web` is one of the servers Atoma ships, and a server no agent names is
  never started.

This is separate from the search over this repository's own issues, which is a tool
server. What each of them is for is in [docs/operations.md](operations.md).

## The deliverable itself

### Move to a newer release

There is no upgrade command, and a copy is not one. The deliverable contains files that
are generated and files that are yours to tune, and only you can say which of your edits
are deliberate. So treat it as vendoring, and let git do the merge:

```bash
gh release download v0.1.115 -R yuma-seno/atomaton -p atoma-delivery.zip
unzip -o atoma-delivery.zip   # the archive holds .github/, so run this at the repo root
rm atoma-delivery.zip
git diff .github/            # every difference is now a decision
git checkout -- .github/atoma/config.yaml    # for anything you meant to keep
```

Name the version rather than taking `latest`, and read the upstream changes between
yours and the next one (`gh release view`, or compare the two tags) rather than
rediscovering them in a diff.

**Which release do I have?** `.github/atoma-release.json` says. It ships with the
release and records the version and every path the release contains:

```bash
jq -r .version .github/atoma-release.json
```

**What did upstream delete?** Extracting never deletes, so a file the template dropped
stays in your tree — and that is not cosmetic. Two workflows were removed in v0.1.71
because work should start only when somebody asks; keeping them keeps the triggers. The
manifest is what makes them findable:

```bash
# Paths you have under .github/ that this release no longer ships.
# Your own files appear here too, which is why it is a list to read, not to pipe
# into rm.
comm -23 \
  <(git ls-files '.github/*' | sort) \
  <(jq -r '.files[]' .github/atoma-release.json | sort)
```

Read it rather than acting on it: your own workflows and your own project skills are
files the template never shipped, and they are supposed to be there.

Which files are replaced wholesale, which are yours outright, and which are both is the
ownership table in [docs/configuration.md](configuration.md). The safest habit is to keep
your customisation where the template will not fight you for it — `config.yaml` covers
the labels, the merge policy, the environment setup, the tool servers and the workflows
to dispatch, and `skills/project/` is yours outright.

### Have something happen every week

Atoma has no schedule setting, and will not grow one — but the thing you want is two
steps away, and both are ordinary.

Copy [`examples/workflows/scheduled-issue.yml`](../examples/workflows/scheduled-issue.yml)
into your own `.github/workflows/`, then edit four things in it: the cron, the issue
title, the issue body, and which agent the last step hands the issue to. If you run more
than one of these, the label it creates and matches on is the fifth — the example uses it
to avoid opening a second issue while the first is still open.

**You have to copy it yourself.** GitHub refuses `GITHUB_TOKEN` writes to
`.github/workflows/**` by identity, on every path and branch, so no agent can add this
for you — and `.github/**` is a governed path, so a person merges the pull request that
adds it. Both of those are the system working, not obstacles to route around.

**Why it creates an issue instead of starting an agent.** Agents work on an issue or a
pull request. Something you want done every week *is* a work item that should exist every
week — so the schedule creates the work item, and everything after that is the machinery
you already have: triggers, the in-progress label, session persistence, review, merge
gates. Nothing needs a schedule-only execution path. It also puts the cost where you can
see it: an issue is free, and whether it becomes an agent run is then an ordinary
decision rather than something a cron expression decided months ago and nobody has looked
at since.

**Why it is not a setting.** `on:` accepts no expression, so a cron string cannot come
from `config.yaml`. That is GitHub's rule, not a choice made here. The workaround — a
fixed daily cron that checks the date inside a script — was considered for deployments
and rejected, and is worse for agents: a deployment that no-ops costs a few seconds of
runner time, while an agent that starts and finds nothing to do costs a billed inference.

**The last step is not optional.** An issue created with `GITHUB_TOKEN` raises no
`issues` event, so the issue would appear and nothing would pick it up. The example
therefore dispatches `atoma-runner.yml` explicitly. That is the same rule as everywhere
else in Atoma — see [docs/operations.md](operations.md).

**What it will cost.** One agent run per firing, whether or not there was anything to do,
except the firings the open-issue guard skips. Multiply your provider's per-run cost by
52 for a weekly schedule, 12 for a monthly one, and decide with that number in front of
you. If the answer is uncomfortable, the schedule is probably too frequent for the work —
which is the question this arrangement puts in front of you rather than hiding.

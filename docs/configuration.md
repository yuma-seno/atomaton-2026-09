# Configuration

For somebody who has Atoma running and wants to know exactly what a setting does.

Everything this project declares lives in one file, `.github/atoma/config.yaml`,
and everything one agent declares lives in that agent's definition. This page is
the long form for both: what each setting is for, and the measurements behind the
numbers that have one. It is the reference, so every settable key is here. If you
have a goal rather than a key, [docs/recipes.md](recipes.md) is the lookup.

The file itself carries a line or two per key — enough to know what you are
looking at while editing. Anything longer is here, so that the config stays
scannable and a reason is written once rather than in two places that can drift.

Paths are not settings. `.github/atoma/README.md` says why.

## What you edit, and what is generated

In your adopted repository, `.github/` is the runtime copy that the workflows
execute. Edit your copied `.github/atoma/` files directly — `config.yaml` for
every setting, and the agent definitions, the skills and the prompt template for
the rest. In this template repository the same files are hand-authored under
`src/`, and `dist/.github/` is generated output that `bun run synth` builds and a
release publishes as `atoma-delivery.zip`.

`config.yaml` is **yours**. Everything else under `.github/atoma/` is generated and
is replaced when you upgrade the template; this file is not, so edits to it
survive. A setting that describes one agent rather than the delivery system belongs
in that agent's definition instead — that file is Atoma's own contract, validated
by `atoma validate`, and keeping the two apart is what lets a definition stay
portable: it describes an agent, not a delivery pipeline. Keep project-specific
settings here rather than in repository variables, where they are neither versioned
nor reviewable.

There is no upgrade command, and a copy is not one. The deliverable contains two
kinds of file, and only you can say which of your edits are deliberate:

| Path | Yours to edit? |
| --- | --- |
| `.github/scripts/**`, `.github/workflows/**`, `.github/atoma/tools/scripts/**`, `.github/atoma/tools/tools.yaml` | No — generated, replace wholesale |
| `.github/atoma/config.yaml` | Yes — every setting lives here on purpose |
| `.github/atoma/skills/project/**` | Yes — your own skills, the template ships none |
| `.github/atoma/agent-definitions/**`, `skills/**`, `prompt-template.md`, `mcp-packages.json` | Both — the template ships defaults it also expects you to tune |

That last row is the awkward one, and no script can resolve it: a difference there
is either an improvement you have not taken yet or a change you made on purpose,
and the files look identical either way.

`tools/tools.yaml` left that row for the first one. It is written from
`tools.servers` in `config.yaml` when the deliverable is built, so an edit to it
is an edit to a build output: replaced on the next upgrade, and invisible to
anyone reading the config to find out what the tool servers are. Change
`tools.servers`.

The procedure — treat it as vendoring, and let git do the merge — is in
[docs/recipes.md](recipes.md), under "Move to a newer release".

## A key that is not a setting

**A key that is not a setting is read by nothing** — so a typo silently does
nothing, which is why the pull request that introduces one now fails. One level
accepts names of your own: `chain.labels` takes more than the three Atoma reads,
so a misspelling there is not caught by this.

The recognised set is held to the code by this template's own
`tests/contract/config-contract.test.ts`, which is not part of the deliverable. It
compares the validator's schema against the `AtomaConfig` interface in
`lib/types.ts`, using TypeScript's own parser. The same test holds this page to
that schema in both directions: a settable key documented nowhere fails it, and so
does a dotted path this page names that the validator would reject.

That second direction is the one that does damage, and it is why every key lives on
this page rather than being restated wherever it happens to come up. A key
documented but not read is a key you write, and the pull request is then failed for
following the documentation — which is exactly what happened while this migration
was under way, with two credential lists described at the wrong depth.

What you get in an adopted repository is the same check, runnable before you push:
`bun run .github/scripts/validate_deliverable.ts --root .`. See
[docs/recipes.md](recipes.md), under "Check your config before pushing".

## How the keys are grouped

By **who consumes the value**. Not by mechanism, and not by how often you edit it:

| Key | The question it answers |
| --- | --- |
| `base_branch` | Where does work branch from, and merge back to? |
| `environment` | What does this project need before an agent can work in it? |
| `checks` | How is a change verified before it merges? |
| `deploy` | How does a merged change reach production? |
| `merge` | When does a person, rather than an agent, perform the merge? |
| `chain` | When does a chain of runs stop and ask a person? |
| `tools` | What can an agent reach, and under what watch? |

The first five are yours. `tools` is the machinery's own and most projects never
touch it.

---

## `base_branch`

Where agent branches start from and where their pull requests target. Empty means
the repository's default branch, which is almost always right.

Agents branch from this and open their pull requests against it. Leave it unset
and both fall back to the repository's default branch, which is what a repository
developing on `main` wants.

Set it if you develop on an integration branch and release by merging that branch
elsewhere — `develop` → `main`, say. Without it every agent pull request aims at
`main`, so ordinary work lands straight in what you release from.

## `environment`

### `setup_commands`

`setup_commands` run before checks, before deployments, and before an agent starts
— all three, on a cold runner every time. They run through `bash -c`, in order,
and stop on first failure: before the agent starts, before
`checks.atoma_runs.commands`, and before `deploy.atoma_runs.targets`. One
declaration, three jobs.

That is the reason to use this field rather than putting `npm ci` at the front of
`checks.atoma_runs.commands`, which works and drifts: the agent's shell and CI
then install their dependencies from two places, and a test that passes for the
agent and fails in CI reaches an engineer as a defect that does not reproduce on
the machine they can see.

Nothing here receives a secret. Setup runs before any credential enters the
environment, in all three jobs.

Agents are told to treat the runner as already provisioned and never to spend
iterations installing or configuring tooling themselves, so anything they need at
run time belongs here. The template ships it empty on purpose: it is
language- and framework-agnostic, and only you know what your project needs.

### `max_reloads`

`max_reloads` bounds how many times one piece of work may rebuild its environment.
It sits here rather than beside the counters in `chain` because of where the
refusal goes: this one is returned to the **agent**, mid-run, and the agent carries
on. The `chain` counters stop a run and hand the work to a person.

```yaml
environment:
  max_reloads: 3
```

There is a limit because **each reload starts a new run, with a fresh time budget** —
an unbounded chain of reloads is an unbounded budget. Three by
default, the same as `CI_RETRY_LIMIT`. When the limit is reached the tool refuses and
tells the agent to report instead; the refusal is a tool error rather than the end of
the run, so the agent still has a turn in which to say what it found.

To turn reloading off entirely, remove `atoma_env` from an agent's `mcp_servers` in
its definition. `0` here means the default, not "never".

## `checks` and `deploy`

Two arms, and exactly one of them. Fill in `atoma_runs` and the shipped workflow
runs your commands; name `your_workflow` instead and it dispatches that, and the
commands are read by nothing. Declaring both is a configuration error rather than
a precedence puzzle you have to remember the answer to.

Under `atoma_runs`:

- `commands` (checks) — run in order, stopping at the first failure.
- `targets` (deploy) — each names an environment, the branch or tag that ships
  to it, and the commands that put it there. Empty means this project deploys
  nothing yet, which is the state a template has to ship in.
- `secrets` — repository secrets that step may reach, by name. The values stay
  in GitHub; only the names are here. Written in full they are
  `checks.atoma_runs.secrets` and `deploy.atoma_runs.secrets` — the nesting is
  load-bearing, and `tools.secrets` below says why the three lists are separate.
- `runs_on` — the GitHub runner label the job asks for. `ubuntu-latest` unless
  the project needs a larger or self-hosted one.

### The default check

A secret scan ships in `checks.atoma_runs.commands`, and it is the only default.
A credential is a credential in every language, so it is the one verification a
template can hand a project it knows nothing about — everything else belongs to
the project.

It is safe to inherit on a repository with years of history because it scans the
range the branch **adds**, not the history. An old finding is not something this
pull request can fix, and failing every pull request over one teaches people to
ignore the check.

If it cannot reach gitleaks — a rate limit, an outage — it warns rather than
fails. "GitHub was busy" must not read as "this pull request added a credential".

### The pipeline as commands

You can point Atoma at workflows you wrote, as below. Or you can write no
workflow at all and describe the pipeline as commands:

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
      - name: production
        on: tag
        tags: ["v*"]
        commands: ["./scripts/deploy.sh prod"]
```

Nothing needs pointing at these — `atoma-check.yml` and `atoma-deploy.yml` are
what a section runs when it names no `your_workflow`. Fill in the commands and
they run.

**Triggers.** `on` is `merge` (a change landing on your default branch, whether an
agent merged it or you did), `tag` (a pushed tag matching `tags`, which is a
literal or a prefix followed by `*`), or `manual`. Any target can also be
dispatched by name whatever its trigger, which is what makes a `manual` rollback
target worth declaring. A tag no target claimed exits cleanly rather than failing,
so tagging for other reasons costs you a few seconds and no red run. Schedules are
not supported: a cron expression can only be written in a workflow's `on:`, so it
cannot come from configuration.

`on: merge` reaches your default branch if it is called `main` or `master`. A
workflow's `on:` cannot say "the default branch", so those two are listed
literally and then narrowed to the branch your repository actually defaults to. If
yours is named something else, an agent's merge still deploys — that path is an
explicit dispatch, not an event — but your own merges will not, and
`deploy.your_workflow` is the way to cover them.

**Credentials** go in the list belonging to whatever needs them —
`checks.atoma_runs.secrets` or `deploy.atoma_runs.secrets`, alongside
`tools.secrets`. Add the secret to the repository first; these name it, they do
not create it. Inside a deployment, `$ATOMA_DEPLOY_TARGET` holds the target's
name. `atoma-deploy.yml` declares `id-token: write`, so a cloud provider's OIDC
login works and is worth preferring over storing a long-lived key at all.

**What commands cannot express**, and where you still need a workflow of your own
through `deploy.your_workflow`:

- a job's `permissions` beyond what the shipped workflows declare. `atoma-check.yml`
  runs with `contents: read` plus a `GITHUB_TOKEN` in `GH_TOKEN`;
  `atoma-deploy.yml` with `contents: write` and `id-token: write`, so it can cut a
  release and can exchange its identity for cloud credentials
- a deployment approval gate — `environment:` takes no expression, so nothing in
  configuration can reach it
- GitHub's own artifact store and cache
- any trigger outside merge, tag and manual dispatch — including a default branch
  named neither `main` nor `master`, for your own merges

Most of the limits people expect are not real. Service containers work through
`docker run`, and a matrix works as a loop, losing only parallelism. Both are
commands.

### `runs_on`

```yaml
checks:
  atoma_runs:
    runs_on: macos-latest
deploy:
  atoma_runs:
    runs_on: ["self-hosted", "linux", "gpu"]
```

A string is one runner label. A list is the set of labels one runner must have —
which is how a self-hosted runner is addressed. Unset takes `ubuntu-latest`.

It sits inside `atoma_runs` because the machine is a property of the step Atoma
runs: a project that names `your_workflow` instead declares its runner in that
workflow, where the rest of its pipeline already is.

**One runner, however many labels. Not several runners.** Several would change the
check run's *name*: `atoma-check` becomes `atoma-check (ubuntu-latest)`, so the
context your ruleset requires stops existing and every pull request waits forever on
a check that will never report.

This applies to the two jobs that run **your** commands. It does not apply to the
agent's own run, which stays on Linux — what isolates a tool server from the others
is Linux-only top to bottom (`useradd` for the user with no sudo, `setfacl` for the
ACLs, `prctl(PR_SET_DUMPABLE)`, `/proc/<pid>/environ` being the thing closed). Making
that configurable would mean an agent's shell running with every one of those
protections silently absent.

### `your_workflow`

```yaml
checks:
  your_workflow: ci.yml
deploy:
  your_workflow: deploy.yml
```

`checks.your_workflow` is the workflow Atoma runs against an agent's pull request
before anyone reviews it. Defaults to `atoma-check.yml`. Name yours here, exactly
as the file is called, or the dispatch fails silently and every merge is refused
for a missing check.

Its result decides what happens next: the reviewer is dispatched when it passes,
the engineer when it fails.

`deploy.your_workflow` is dispatched after a successful merge — required rather
than optional if your deployment is chained off CI or off a push to the base
branch. An agent merge is performed with `GITHUB_TOKEN`, and GitHub starts no
workflow run for events its own token triggers (see
[docs/operations.md](operations.md)), so nothing downstream of that merge fires by
itself and your deployment would silently never run. Defaults to
`atoma-deploy.yml`, which does nothing when no target deploys on merge.

**Delete the `atoma_runs` block in the section you name a workflow in.** The two
are alternatives: declaring both fails the pull request's check, naming the
section, rather than resolving by a precedence rule — so a `commands` list left
behind is reported instead of sitting there reading as live.

A workflow Atoma is to start must accept `workflow_dispatch`, and a workflow that
reads the pull request from the event payload gets nothing on a dispatched run.
Both are in [docs/setup.md](setup.md) and [docs/recipes.md](recipes.md)
respectively.

## `merge`

Every member composes: any one of them firing puts the merge in a person's hands.

- `policy` — `manual` means an agent never merges. `auto` means it may, when
  nothing else objects.
- `governed_paths` — changes touching these are a person's to merge whatever the
  policy says. The default covers the machinery: the workflows, the agent
  definitions, the tool configuration, this file.
- `gates` — conditional escalations, each carrying the reason a person is being
  asked.

What GitHub enforces is separate and lives in `.github/atoma/rulesets/main.json`,
in GitHub's own import format. On a repository where branch rules are unavailable
— they are a paid feature on a private one — GitHub refuses nothing and these
settings are the whole of the gate.

### `merge.governed_paths`

An agent will not merge a pull request that changes how agents run. It reviews it
and reports, and the merge is yours.

Covered by default:

```text
.github/**
```

That is where an agent's limits live — which credentials reach a run, the scripts
the runner executes to decide when a run may continue, which commands the shell
hook refuses, what a ruleset requires before a merge. An agent that could merge a
change to them could widen its own reach, and nothing later catches it, because
the next run already obeys the new file.

This is not about an agent intending to. A prompt injection carried in an issue
body reaches exactly as far, and so does an ordinary mistake. Both stop at a
person reading the diff.

The whole directory rather than the parts of it that obviously matter. An earlier
default named four subdirectories and left out `.github/scripts/**`, which is
where the runner's own control logic lives — nothing decided that, the list was
simply written before the directory existed. A list of the paths that count has
to be revisited every time the tree grows, and gives no sign when it has not been.

Narrow it, or extend it, with `merge.governed_paths`, which replaces the default:

```yaml
merge:
  governed_paths:
    - ".github/**"
    - "infra/**"
```

Set it to `[]` to turn the gate off.

If you deliberately want a corner of `.github/` back — issue templates, say —
name the parts you do want governed instead. Prefer that to a narrower default:
being explicit about the exception leaves a record of the decision.

Note what this does *not* do. The provider API key and `GITHUB_TOKEN` are in the
agent's own environment because the run needs them to work at all, and no setting
moves them out.

Every other repository secret stays outside that environment until you name it.
Nothing reaches an agent by being a secret; it reaches an agent by being
declared, and the declaration is in a file this gate already covers — see
`tools.secrets` below.

### `merge.gates`

`merge.governed_paths` covers Atoma's own machinery. Your project has its own
things that should not land unread — a database migration, a change to a pricing
table, a release note — and they are not describable as a path alone. "Anything under
`db/migrations/`" is sayable; "only when a migration is **added**" is not.

`merge.gates` is that, and it behaves exactly like the gate above: the agent
reviews the pull request, posts the review, and says it is ready for a person. The
merge is yours.

```yaml
merge:
  gates:
    - reason: "This adds a database migration. Please check it before merging."
      when:
        files_added: ["db/migrations/**"]
```

`reason` is written to a person and relayed to them verbatim, in whatever language
you write it in. It is the whole output of the gate, so say what you want checked
rather than restating the condition.

**Conditions.** Every one you name must hold, so one gate is one situation.
Several gates are several situations.

| Condition | Matches when |
| --- | --- |
| `files_added` | a file the pattern claims was added (a rename into it counts) |
| `files_removed` | a file the pattern claims was deleted (a rename out of it counts) |
| `files_modified` | an existing file the pattern claims changed |
| `files_changed` | any of the three — what `merge.governed_paths` matches on |
| `labels` | the pull request carries any one of these labels |
| `title_matches` | the title matches this regular expression, case-insensitively |

A pattern is a literal path or a directory followed by `/**` — the same two forms
`merge.governed_paths` accepts, and the only two. Anything else, `**/*.sql`
included, is rejected when the file is read rather than quietly matching nothing.

**Mistakes are errors, not silence.** A misspelled condition, a pattern this
matcher cannot honour, a gate with no conditions at all: each stops the merge and
says why, instead of producing a gate that never fires. A gate that never fires
looks exactly like a gate you did not need, and you would find out from the merge
that went through.

For the same reason a gate that cannot be read blocks rather than disappearing.
Otherwise the way past a gate would be to break it.

**Why not a required status check.** A required check stops everyone, including
you. These stop only the agent, which is the actual request: not "this must not be
merged" but "this is not an agent's call".

**Why configuration and not a script.** A script could read a migration and notice
it drops a production table, which no amount of configuration can. It also needs a
timeout, a decision about what a crash means, and protection against a pull
request supplying the very program that judges it. `config.yaml` is read from the
default branch already, so a pull request cannot weaken the gate that is judging
it. If you hit a real case that conditions cannot express, that is worth an issue —
the shape here leaves room for it.

## `chain`

`after_handoffs` bounds agent-to-agent handoffs with nobody else commenting; a
person joining the thread resets it. `after_runs_without_change` counts
consecutive runs that pushed nothing, opened nothing and merged nothing.

`labels` names three: `in_progress` while a run holds an issue, `launched` once
it has handed work on, and `sub_issue` on the issues it opened. They are in this
section rather than somewhere presentational because that is what the labels are
for: state one run leaves for the next to read. They are not
`merge.gates[].when.labels`, which are labels a **person** applies to a pull
request. Change these only on a name collision.

### `chain.after_handoffs`

```yaml
chain:
  after_handoffs: 5
```

An agent finishing its turn can name the next one, and that one can name another.
Left alone, an engineer and a reviewer will pass a pull request back and forth for
as long as each keeps finding something. This is where that stops and a person is
asked.

Counted from the target's own comments: how many agent result comments there are
since the last comment **a person** wrote. Nothing is stored, so a re-dispatch, a
new workflow run or a lost session does not reset it.

Five is the default. It is chosen against a repository where a person intervenes
often — the longest chain measured was three — so **running autonomously you will
want a larger number**, and wanting closer supervision a smaller one. `0` means the
default rather than "no handoffs"; `1` is how you say that an agent finishes its
own turn and hands off to nobody.

### `chain.after_runs_without_change`

```yaml
chain:
  after_runs_without_change: 2
```

The limit above counts runs. This one counts **runs that changed nothing**, which is
the thing actually worth stopping.

A count of runs is a poor proxy in both directions. One piece of work here spent
2,299k tokens and finished; a loop going nowhere can spend 30k and finish nothing.
Cutting on how much happened stops the large legitimate job and lets the small
useless one run.

So a run that pushed no commit, opened no pull request and merged none is recorded
as having changed nothing, and two of those in a row stops the chain. It fires
sooner than `after_handoffs` on repetition, and never on a long piece of real work,
because length is not what it measures.

Two is the default. One run that changes nothing is ordinary — an agent asked a
question, or investigated and reported. `0` means the default.

What you see when either limit fires, and how to resume, is in
[docs/operations.md](operations.md).

## `tools`

The machinery's own configuration, declared here rather than in a second file
because this project owns the runtime it uses. An adopter configures Atoma; they
do not configure the binary Atoma runs. The generator writes the part the core
reads into the tools file it is handed.

### `tools.secrets`

Repository secrets the servers may reach, by name.

Separate from `checks.atoma_runs.secrets` and `deploy.atoma_runs.secrets` because the nesting **is** the
boundary: only these enter an agent's own environment, so a prompt injection
carried in an issue body reaches them and no deployment credential. Collapsing the
three into one list would put every credential in every destination while still
looking like a boundary, which is worse than having no boundary at all.

The declaration is here rather than in a repository variable because it is the
most security-relevant setting this project has. In the config it is versioned, it
shows up in a diff, and it passes the governance gate that already covers
`.github/**`. In repository settings it would be invisible to everyone reviewing
the repository — precisely the audience for "what credentials can this reach".

Naming a secret authorises the run to hold it. It does not deliver it to any tool;
the next section is the step that does.

### Why a credential has to be routed

Because a tool server receives only what its own `env:` names. Anything Atoma
recognises as a credential is removed from a server's environment before that
block is applied, so `env: {}` means "this server gets no credentials" — which is
the default, and is the point rather than an oversight.

The shell tool is the one to think about. It can run anything, so a credential it
can read is a credential the agent can read and send anywhere. Leaving it out of
`shell`'s `env:` is what makes "the tool holds the secret, the agent does not"
true rather than aspirational.

Which layer decides what:

| Layer | Decides |
| --- | --- |
| Repository secrets | the value |
| `tools.secrets` | whether the run may hold it |
| `tools.servers.<name>.env: ${NAME}` | which tool receives it |

The bottom two are keys in one file now and are still two decisions: the list says
what the run may hold, a server's `env` says which server sees it, and the second
is what keeps the first out of the shell. Authorising a credential does not
deliver it. `checks` and `deploy` need no third step at all, because their
commands run in a workflow of their own rather than beside an agent — a secret
named in `checks.atoma_runs.secrets` is in that job's environment and there is no
server to route it to.

Never write a value in the config, only a `${NAME}` reference. A pasted secret
is committed in plain text.

You never edit a workflow for any of this, and you never edit
`tools/tools.yaml`: it is generated from `tools.servers` when the template is
built. The three-step procedure is in [docs/recipes.md](recipes.md), under "Give a
tool a credential"; what the routing does and does not protect is in
[docs/operations.md](operations.md).

### What fails loudly

Four things fail the run rather than being quietly dropped, because a credential
that was asked for and silently not delivered surfaces much later as a tool
failure pointing nowhere near the cause:

- a name that is not shaped like an environment variable (`SLACK_TOKEN`, not
  `slack_token` or `Slack-Token`)
- a name the run already uses for itself, such as `GH_TOKEN` or
  `OPENAI_API_KEY` — declaring one would replace the run's own value rather than
  add a credential
- the same name twice
- more than ten names, which is the number of slots the generated workflow
  carries; raising it needs a new release

Naming a secret the repository does not actually have is a warning rather than a
failure. The run itself is unaffected, and only the tool needing that value will
fail — with the reason already in the log.

### `tools.servers`

One entry per server: `command`, `args`, `env`, `hooks`, `request_timeout_secs`,
and `settings` — the last being this project's own, stripped by the generator so
it never reaches the core. Everything else is the core's own tools-file format,
one level in, and is passed through untouched, so a key a later core release adds
works the day it ships.

`.github/atoma/tools/tools.yaml` is written from this section when the template is
built and is not edited. Tool scripts and MCP servers live under
`.github/atoma/tools/scripts/`.

A server may not be called `hooks`: that name is the core's own reserved key at
the top level of a tools file, which is where `tools.watch` is written, and a
server called `hooks` would silently become one. The build refuses it.

#### `request_timeout_secs`

Atoma cuts off one `tools/call` after 60 seconds. If a server can take longer,
say so in its entry:

```yaml
tools:
  servers:
    my_tool:
      command: bun
      args: ["run", "./scripts/my_tool.ts"]
      request_timeout_secs: 600
```

`0` means the default, the same as leaving it out. A timeout argument in a tool's
own schema does not raise this, and raising it just in case costs you the only
thing that notices a server which has stopped responding —
[docs/writing-a-tool.md](writing-a-tool.md) has both, with the measurements.

#### `reranker_model`

Two stages produce the issue search's ranking. A lexical first stage casts a wide
net over every passage; a cross encoder then reads the twenty issues it caught and
decides which of them actually answers the question. Only the second stage is
configurable, because measurement put the whole difference there — enlarging
the reranker moved top-1 accuracy from 27% to 91%, while adding a dense vector
index alongside the first stage changed no ranking at all.

```yaml
tools:
  servers:
    search:
      settings:
        reranker_model: onnx-community/bge-reranker-v2-m3-ONNX
```

It sits under the server because the server itself reads it, not the core:
`settings` is the one key this project reserves inside a server entry, and the
generator strips it out of the tools file the core is handed, which would
otherwise refuse a key it does not know.

The default is multilingual and about 600MB, downloaded once per runner and
cached after that. Name a smaller cross encoder here if that cost matters more
than ranking quality, or a language-specific one if your issues are all in one
language. Any model the runner can load as a sequence-classification cross
encoder works; the search still functions if it fails to load, falling back to
the first stage's own order.

### File-wide hooks

`tools.watch` holds hooks that apply to every server, beside `tools.servers`
rather than inside any one of them. The generator writes them into the tools file
under `hooks`, the name the core reserves there. The appendix below says why a
file-wide hook is usually the right shape.

---

# Agent definitions

One Markdown file per agent under `.github/atoma/agent-definitions/`, with the
settings in its frontmatter. This is Atoma's own contract rather than this
project's, which is why a setting that describes one agent belongs here and not in
`config.yaml`: a definition stays portable because it describes an agent, not a
delivery pipeline.

## `model`

The model that agent runs on. Edit `.github/atoma/agent-definitions/<agent>.md`
and update the frontmatter `model` field.

## `vision`

An agent gets pictures from a tool only when its definition says so:

```yaml
vision: true
```

Set it when the model reads images, and leave it off when it does not. Without
it, a tool that returns a picture delivers text in its place saying the image was
withheld and naming this setting — so a model that could have read one tells you,
instead of the picture disappearing.

The default is off because the two mistakes cost differently. Sending a picture
to a text-only model is an API error that loses the run; withholding one from a
model that could have read it costs a single tool result, and says why.

The shipped agents are set this way: the reviewer and orchestrator read images,
the engineer does not. Checking whether a model can, before you set it, is in
[docs/recipes.md](recipes.md).

## `provider`

The frontmatter `provider` field selects the client, not the vendor:

| Value | API | Credential | Endpoint |
| --- | --- | --- | --- |
| `openai` | Chat Completions (`/chat/completions`) | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `openai-responses` | OpenAI's Responses API (`/responses`) | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `openrouter` | Chat Completions | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `openrouter-responses` | Responses | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `orcarouter` | Chat Completions | `ORCAROUTER_API_KEY` | `https://api.orcarouter.ai/v1` |
| `orcarouter-responses` | Responses | `ORCAROUTER_API_KEY` | `https://api.orcarouter.ai/v1` |
| `anthropic` | Anthropic Messages | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| `github-copilot` | Copilot, over Chat Completions | `ATOMA_COPILOT_TOKEN` | `https://api.githubcopilot.com` |

All three shipped agents declare `openrouter-responses`, so
`OPENROUTER_API_KEY` is the credential an adoption needs.

**One provider, one credential, and the credential is what selects the provider**
when neither the agent definition nor the `ATOMA_PROVIDER` variable names one. Add
exactly the secret for the provider you intend to use. Adding two is an error naming
both, rather than a precedence that picks for you — before atoma v0.1.13,
`OPENAI_API_KEY` selected a client whose endpoint defaulted to OpenRouter, so the
name of the secret said nothing about where the key was sent.

Each endpoint moves with its own `*_BASE_URL` variable (`OPENROUTER_BASE_URL` and so
on). None of them may be declared in `tools.secrets`: moving a provider's endpoint is
a way to send its credential somewhere else.

Which of the two OpenAI entries to prefer, and how to reach a provider with no row
of its own, are in [docs/recipes.md](recipes.md).

## `extra_body`, and the `tools:` block that is not there

Atoma merges every `extra_body` key straight into the request body, so what goes
there is the provider's own contract rather than an Atoma feature. The shipped
definitions use it for OpenRouter's provider routing; pinning an endpoint is in
[docs/recipes.md](recipes.md).

The shipped agents declare no `tools:` block, so nothing triggers provider-side
tool dispatch today. They used to declare `openrouter:web_search` and
`openrouter:web_fetch`, and both were removed: a provider-side tool reaches the
web outside this repository's own `web` server, so the request is not logged, the
response is not capped, and what an agent fetched cannot be read back from the run
log. Reaching the web through `web__fetch` is all three of those things.

## Optional repository variables

Two repository **variables** — not secrets — both for reaching a provider
somewhere other than its default host:

- `ATOMA_PROVIDER` overrides the `provider` in an agent definition. One of the
  eight values in the table above, not two.
- `OPENAI_BASE_URL` moves OpenAI's endpoint only. Each provider has its own
  (`OPENROUTER_BASE_URL`, `ANTHROPIC_BASE_URL`, and so on), for the same reason
  each has its own credential.

Neither may be declared in `tools.secrets`; both are reserved for exactly that
reason.

## The prompt template, and the skills

`.github/atoma/prompt-template.md` is what every agent is told, whichever one it
is. It is passed to Atoma with `--template` on every runner invocation.

Skills live under `.github/atoma/skills/**/*.md`. The template ships none under
`skills/project/`, which is yours outright.

---

# The tool servers

What follows was written beside the settings themselves, and is kept in full.

## The file as a whole

Tools configuration for Atoma GitHub templates

Every server named here must cover the union of `mcp_servers` across
.github/atoma/agent-definitions/*.md. An agent naming a server that is absent
here aborts before any MCP server starts ("Tool 'X' not found in tools file"),
so removals must be checked against all three agents, not just the one in
front of you. `agent-definitions.test.ts` enforces this.

This is where a credential is ROUTED to the server that needs it, with a
`${NAME}` reference in that server's `env`. A server receives exactly what it
names here and nothing else -- atoma removes every credential it knows about
from a server's environment before applying this block, so leaving `env: {}`
means "this server gets no credentials", and that is the point rather than an
oversight.

`args` paths carry `${ATOMA_MACHINERY_ROOT:-.}` for a different reason, and it is
not about secrets. On a pull request run the workspace IS the pull request, so a
server read from `.github/atoma/tools/scripts/...` would be the pull request's
own copy -- letting it replace the code of the tools that review it. The prefix
points at a checkout of the default branch instead, and falls back to `.` where
no such checkout exists, such as a hand-run `atoma`.

`args: ["."]` on the filesystem servers is deliberately NOT prefixed: that one
is the workspace, which is exactly what those servers should be reading.

`before_tool` is NOT prefixed either, and for a third reason: atoma resolves a
relative hook path against the directory of THIS file, not against the working
directory. Verified in the core -- `persistence/tool_def.rs` sets
`base_dir = path.parent()` and joins any non-absolute hook path onto it, then
fails the run if the result does not exist. The runner passes
`--tools-file ${ATOMA_MACHINERY_ROOT}/.github/atoma/tools/tools.yaml`, so the
hook comes from the same default-branch checkout the `args` prefix points at,
and gets there without being asked.

Written down because the paragraph above argues the pull-request-replaces-the-
code point for `args` and said nothing about the hook -- and the hook is the
one piece of code that inspects what the agent is about to run, so a reader
checking that argument holds should not have to go and read the core to
find out.

Never write a value here, only a reference. `${SLACK_TOKEN}` is resolved at run
time; a pasted secret would be committed in plain text.

Where the value comes from is a different layer. Add the secret to the
repository, then name it in `tools.secrets` -- that authorises the run to obtain
it at all. The `env` entry here decides which server reaches it. Both steps are
needed and neither substitutes for the other; see [docs/recipes.md](recipes.md),
"Give a tool a credential".

## `tools.watch`

Hooks that apply to EVERY server, run before each server's own.

It is called `watch` in the config so that it does not sit beside the per-server
`hooks` meaning something narrower. The generator writes it into the tools file
under `hooks`, which is the name the core reserves at that level -- so a server
may not be called `hooks`, and the build refuses one that is. The
file-wide form exists because what is worth watching is usually the run rather than
a tool: how much has been written where, how long a search has gone on. Attached to
one server, such a check only watches the agent while it happens to be using that
server, and says nothing for the twenty calls it spends elsewhere.

`workspace_guard.ts` answers with a notice when /tmp/atoma-workspace has grown past
what will be carried into the next run. It is an `after_tool` rather than a
`before_tool` because it reports rather than refuses -- nothing the agent is about to
do is wrong, and the file it would complain about does not exist until after the
call that wrote it.

## filesystem

`directory_tree` returns the whole tree, always, and there is no question
whose answer is the whole tree. `list_directory` answers the ones there are.

`search_files` used to be here beside it, and was let back in once atoma
v0.1.21 capped every tool result: what kept it out was unbounded output, not
what it does. Worth being precise about what it does, though -- it matches
PATHS against a glob and never reads a file, so it does not replace a grep.
An agent was measured making 324 content searches through the shell; this
tool would have replaced none of them. A semantic code search is the gap that would.

## filesystem_readonly

Returns an image as an image block rather than as bytes read into text.
An agent whose definition sets `vision: true` can look at a screenshot
in the repository; one without it gets a note saying the picture was
withheld. Reading an image through `read_file` produces neither.

## shell

The one server that runs arbitrary commands, and therefore the one that runs
third-party code: a dependency's postinstall, a setup.py, a build.rs. Those run
with this server's privileges.

Every tool server -- this one included -- runs as one dedicated OS user that is
NOT in sudoers, so no tool's environment differs from another's. Which credentials
that arrangement protects, and which it deliberately leaves exposed to this
server, is in [docs/operations.md](operations.md) under "What a tool can and
cannot be protected from". Read it before routing a credential to a third-party
server.

`request_timeout_secs: 3600` matches what `shell_execute` already advertises:
`timeout_seconds` accepts up to 3600. Every value above 60 was unreachable before
this, because atoma capped every server at 60 seconds and the resulting error
named the shell server rather than the client that gave up -- so a test suite or
a build running over a minute looked like a broken tool.

The server enforces its own per-call limit and always answers, so this is a
backstop for the server itself dying rather than a limit on the work.

$HOME is the runner's, readable and NOT writable, the same for every tool. A
write there fails rather than appearing to work: caches are redirected to a
writable directory by the environment the runner sets. That is the one thing an
agent has to know, and `shell_execute`'s description says it.

It ran in a rootless podman container until v0.1.62. That bought isolation from
the other servers by giving the shell a different filesystem: $HOME was an
overlay, so a write there succeeded and then was not there for anything else.
Measured over this repository's stored sessions, the agent crossed that boundary
in 18 of 2,118 shell calls -- rare, and silent every time, which is the worst
combination. A write that reports success and does not persist is a thing an
agent cannot reason about.

## github

Shells out to `gh`, so it needs the run's GitHub token. Declared rather
than inherited: atoma strips credentials from a server that does not name
them, which is what keeps this one out of `shell`.

## web

_(no comment)_

## search

Searches this repository's issues by meaning. Imports
`@huggingface/transformers`, which the runner installs from
`mcp-packages.json`'s `bun` list rather than receiving in the bundle — see
build-dist.ts for why that one cannot be inlined.
Shells out to `gh`, so it needs the run's GitHub token. Declared rather
than inherited: atoma strips credentials from a server that does not name
them, which is what keeps this one out of `shell`.
The first search of a run may have to load the reranker, a 544MB ONNX file:
measured at 63.9s against atoma's 60s default, so the first search of every
run failed and the answer arrived 15 seconds after nobody was waiting for it.

The server now starts that load when it starts rather than when the first
search arrives, which absorbs most of it -- there were 47 seconds between the
server connecting and the first search in the run that measured this. 300
covers the remainder and a slow network, without being so large that a
genuinely stuck server goes unnoticed for long.

## atoma

Shells out to `gh`, so it needs the run's GitHub token. Declared rather
than inherited: atoma strips credentials from a server that does not name
them, which is what keeps this one out of `shell`.

## atoma_env

The same server, with everything but `reload_environment` withheld.

`reload_environment` is for whoever is doing the work -- the engineer, which is
the agent that finds a dependency missing. The other two tools on this server are
the orchestrator's: `request_close_issue` calls itself "the ONLY correct way for
the orchestrator to finish an issue", and an engineer that could call it could end
an issue without a review. So the server cannot simply be handed over.

A second entry with an allowlist is how this project already solves that:
`filesystem_readonly` above is the same server as `filesystem` with writes
withheld, so the reviewer can read the tree without being able to change it. Same
mechanism, same reason.

The cost is a second process of the same script and a longer tool name the agent
reads. Both are visible, which is the point -- the alternative is one server whose
tools mean different things depending on who called them.

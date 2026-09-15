# Configuration

Everything this project declares lives in one file, `.github/atoma/config.yaml`.
This page is the long form: what each setting is for, and the measurements behind
the numbers that have one.

The file itself carries a line or two per key — enough to know what you are
looking at while editing. Anything longer is here, so that the config stays
scannable and a reason is written once rather than in two places that can drift.

Paths are not settings. `.github/atoma/README.md` says why.

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

## `environment`

`setup_commands` run before checks, before deployments, and before an agent starts
— all three, on a cold runner every time.

`max_reloads` bounds how many times one piece of work may rebuild its environment.
It sits here rather than beside the counters in `chain` because of where the
refusal goes: this one is returned to the **agent**, mid-run, and the agent carries
on. The `chain` counters stop a run and hand the work to a person.

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
needed and neither substitutes for the other; see docs/customization.md, "Give a
tool a credential".

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

It used to run in a rootless podman container -- twenty-five lines of argv, an
overlay of $HOME, a generated /etc/passwd, subordinate id ranges and a
newuidmap shim, all documented across twenty-four measurements. All of
that is gone. The reason is worth reading before adding a tool of your own,
because it decides what you can expect of one.

### Three things cannot all be true

  (a) every tool sees the same environment
  (b) a credential in one tool is hidden from this one
  (c) any third-party MCP server works

Pick two. (c) means a server takes its credential the way it was written to,
which is an environment variable. (a) means this server shares the filesystem
and the OS user with it. Given both, (b) fails -- and not through one hole that
can be closed. `/proc/<pid>/environ` is readable between processes of one user;
a fake binary on PATH is executed by the server that looks for it; a config file
under $HOME tells another tool what to run. Each of those has an answer here --
the flag, the PATH narrowing, a read-only $HOME -- and the point is that the LIST
is not enumerable, so closing the three that are known is not a guarantee.

The container bought (b) by giving up (a): $HOME was an overlay, so a write there
succeeded and then was not there for anything else. Measured over this
repository's stored sessions, the agent crossed that boundary in 18 of 2,118
shell calls -- rare, and silent every time, which is the worst combination. A
write that reports success and does not persist is a thing an agent cannot
reason about.

### What was chosen

(a) and (b) for the tools this project ships. (c) as a documented limit rather
than a guarantee.

Every tool server -- this one included -- runs as one dedicated OS user that is
NOT in sudoers. One user, so no tool's environment differs from another's. No
sudo, because with it nothing else matters: `sudo cat /proc/<pid>/environ` reads
anything, whatever else is arranged.

What that leaves protected:

  The provider API key. It is never in a tool server at all -- atoma holds it,
  and makes itself non-dumpable, so no tool can read it even as the same user.

  Credentials in the servers this project ships. They call `prctl(PR_SET_DUMPABLE, 0)`
  at startup, which makes their own /proc entries unreadable, and drop
  world-writable directories from their PATH so a planted binary is not found.

What that leaves exposed, deliberately:

  GH_TOKEN, to this server. It expires with the job, the agent can already use
  it through the github tools, and `actions/checkout` leaves the same value in
  `.git/config` inside the work tree -- so the container was not protecting it
  either.

  A credential routed to a THIRD-PARTY server via config.yaml's `tools.secrets`.
  That server cannot be made to protect itself, and no arrangement here can do
  it for it. See docs/customization.md, "What a tool can and cannot be
  protected from", before routing a credential to one.

### What this means when you add a tool

Nothing to configure, and nothing to reason about: your server sees the same
filesystem, the same $HOME and the same user as every other tool. The one rule
is the exposure above -- a credential you give a third-party server is readable
by this one.

$HOME is the runner's, readable and NOT writable, the same for every tool. A
write there fails rather than appearing to work: caches are redirected to a
writable directory by the environment the runner sets. That is the one thing an
agent has to know, and `shell_execute`'s description says it.
Matches what `shell_execute` already advertises: `timeout_seconds` accepts up
to 3600. Every value above 60 was unreachable before this, because atoma
capped every server at 60 seconds and the resulting error named the shell
server rather than the client that gave up -- so a test suite or a build
running over a minute looked like a broken tool.

The server enforces its own per-call limit and always answers, so this is a
backstop for the server itself dying rather than a limit on the work.

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

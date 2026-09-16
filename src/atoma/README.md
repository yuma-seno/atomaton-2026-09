# `.github/atoma/`

Everything an agent run reads. One directory, and the path of each thing in it is
how you know what it is.

| Path | What it holds |
| --- | --- |
| `config.yaml` | Every setting this project declares. The only file here you are expected to edit — see [docs/configuration.md](https://github.com/yuma-seno/atomaton/blob/main/docs/configuration.md). |
| `agent-definitions/<name>.md` | One agent: which model, which tools, and the role prompt. `<name>` is what `/<name>` dispatches. |
| `prompt-template.md` | The system prompt each role prompt is placed into. |
| `skills/<category>/<name>.md` | Instructions loaded on demand. `<category>/<name>` is the name an agent asks for. |
| `tools/scripts/mcp/*.ts` | The tool servers themselves — the eight below. The file `atoma` is handed is written from them per run and never lands here. |
| `tools/scripts/hooks/*.ts` | What inspects a tool call before or after it runs. |
| `mcp-packages.json` | npm packages the servers need. Its hash is the cache key. |
| `rulesets/main.json` | Branch protection, in GitHub's import format rather than ours. |

`.github/scripts/` sits outside this directory and holds the programs the
workflows run. `.github/workflows/` is where GitHub requires workflows to be.

## The tool servers a run starts with

Eight, and they are not in `config.yaml`. They are in the template's own
`domain/shipped-servers.ts`, written into the file `atoma` reads at the start of
every run.

| Server | What it is for |
| --- | --- |
| `filesystem` | Reads and writes files in the work tree. |
| `filesystem_readonly` | Reads files and nothing else, for agents that must not write. |
| `shell` | Runs one foreground command. Guarded, and holds no credentials of its own. |
| `github` | Issues, pull requests, comments, and every Git mutation. |
| `web` | Fetches a URL. Searching the web is a skill, not a tool. |
| `search` | Ranked search over this repository's issues and code. |
| `atoma` | Atoma's own operations: sub-issues, handoffs, stopping a run. |
| `atoma_env` | Rebuilding the run's environment, and nothing else. |

An agent gets the ones its own `mcp_servers` names, and only those. A server
nobody names is never started, so there is nothing to gain by removing one — which
is why there is no way to.

**Why they are not in the file you edit.** Deleting one takes a capability from
every agent that named it, and `atoma` stops the run before a single tool starts
rather than continuing without it. `config.yaml` is the file this README calls
yours; sixty-six of its ninety-three lines used to be these eight, which is a lot
of machinery to keep in a file labelled that way. The line drawn was: **hide what
breaks when it is edited wrong, show what degrades.** A skill or a prompt template
edited badly makes an agent less well-informed and the run carries on; those stay
where you can reach them.

**What you can still do**, in `tools.servers`:

- **add one** — a name not in the table above is yours, and is merged in
- **override one** — the same name, field by field. Raising `request_timeout_secs`
  on `shell`, or routing a credential to `github` through `env`, says only that and
  inherits the rest, so an upgrade still moves the parts you did not touch

And in `tools.watch`, hooks of your own. They run after Atoma's, on every call to
every server; they are added to what it watches rather than replacing it.

If you name a server that does not exist, `atoma` says so and lists the ones that
do — on the pull request, before anything runs.

## The paths are not configurable, deliberately

There is no setting that says where any of this lives. That is a decision, not an
omission, and it is the one place this deliverable chooses convention over
configuration.

**A path here is how a reader recognises what a file is.** `agent-definitions/`
says what it holds. A `definitions_dir` key pointing anywhere would say only that
somebody chose — and the next person has to open the config before they can read
the repository.

Three mechanisms are built around this directory being one root, and a redirected
path breaks all three at once:

- The run grants the tool user read access to the machinery root. A file outside
  it is unreadable to the servers, and the symptom is "no server started" rather
  than "that path was wrong".
- `merge.governed_paths` defaults to `.github/**`. That is what keeps a change to
  a model, a tool list or a role prompt in a person's hands. Moving
  `agent-definitions/` elsewhere leaves that gate permanently, on a single
  approval that reads as tidying up.
- Upgrades replace this directory **by position** — `unzip -o` over it, then your
  `config.yaml` restored. A redirected tree is never upgraded again, and the new
  upstream copy lands beside it unread.

And one of them could never be a setting whatever was decided about the rest:
`.github/scripts/` holds the programs that open the configuration. A file cannot
say where to find the thing that reads it.

## Why the core is configurable and this is not

`atoma`, the binary a run executes, takes every one of these paths as a
command-line argument and hardcodes no layout at all. That looks like the opposite
decision. It is not.

The core has no project of its own — it is handed a layout and works in whatever
it is given. **This deliverable is the layout.** The core's configurability is the
seam through which this repository exercises ownership, and the constants in
`src/domain/machinery-layout.ts` are what it passes through that seam.

So: settings describe policy — what to check, what may merge, what a tool may
reach. Paths describe structure, and structure is what a name is for.

## Changing any of this

Everything here except `config.yaml` is replaced wholesale on upgrade. Edit it and
the next upgrade takes your edit with it.

The file `atoma --tools-file` reads is not in this directory at all, so there is
nothing there to edit: each run writes it into the runner's temp directory — the
eight servers above, with whatever `tools.servers` in the config adds or overrides
— and throws it away with the runner. It used to ship, which gave a repository a
config and a file generated from it that nothing here could regenerate — editing
the config changed nothing, and adding a server blocked every run. If an upgrade
from a release that shipped one left a `tools/tools.yaml` behind, nothing reads
it; delete it.

`config.yaml` is yours: the upgrade deliberately restores it. If you need a
different agent, a different skill or a different tool, that is what a fork is
for — and `merge.governed_paths` is what puts such a change in front of a person
first.

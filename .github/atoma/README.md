# `.github/atoma/`

Everything an agent run reads. One directory, and the path of each thing in it is
how you know what it is.

| Path | What it holds |
| --- | --- |
| `config.yaml` | Every setting this project declares. The only file here you are expected to edit — see [docs/configuration.md](https://github.com/yuma-seno/atomaton/blob/main/docs/configuration.md). |
| `agent-definitions/<name>.md` | One agent: which model, which tools, and the role prompt. `<name>` is what `/<name>` dispatches. |
| `prompt-template.md` | The system prompt each role prompt is placed into. |
| `skills/<category>/<name>.md` | Instructions loaded on demand. `<category>/<name>` is the name an agent asks for. |
| `tools/tools.yaml` | The tool servers a run may start — **generated** from `tools.servers` in `config.yaml`. Edit the config, not this. |
| `tools/scripts/mcp/*.ts` | Those servers. |
| `tools/scripts/hooks/*.ts` | What inspects a tool call before or after it runs. |
| `mcp-packages.json` | npm packages the servers need. Its hash is the cache key. |
| `rulesets/main.json` | Branch protection, in GitHub's import format rather than ours. |

`.github/scripts/` sits outside this directory and holds the programs the
workflows run. `.github/workflows/` is where GitHub requires workflows to be.

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
the next upgrade takes your edit with it. `tools/tools.yaml` goes further: it is
written from `tools.servers` in the config every time the deliverable is built, so
an edit there is gone before the upgrade even reaches it.

`config.yaml` is yours: the upgrade deliberately restores it. If you need a
different agent, a different skill or a different tool, that is what a fork is
for — and `merge.governed_paths` is what puts such a change in front of a person
first.

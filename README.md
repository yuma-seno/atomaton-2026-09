# Atomaton

Atomaton is a copyable GitHub Actions delivery system powered by
[Atoma](https://github.com/yuma-seno/atoma), not Atoma core itself.

An agent only ever starts because a repository member asked for it — by name, in an
issue or a comment. Nothing starts from a GitHub event on its own, so a pull request
from outside cannot spend your model budget.

## What you get

After adoption, naming an agent on an issue or pull request starts a run that:

- restores that agent's session, so it remembers the issue across runs
- runs Atoma with your configured agents, tools and skills
- comments its result back on the issue or pull request
- dispatches the next agent when one is asked for

## Running it in five minutes

The deliverable ships as a release asset. Extract it at your repository root — the
archive holds `.github/`, so the files land where they belong:

```bash
cd /path/to/your-repo
curl -fsSL -o atomaton-delivery.zip \
  https://github.com/yuma-seno/atomaton/releases/latest/download/atomaton-delivery.zip
unzip -o atomaton-delivery.zip
rm atomaton-delivery.zip
```

Then commit it, and do everything in **[Setup](docs/setup.md)**, in order — the first
run needs a repository setting and a credential, and will not start without them.

With those done, open an issue whose first non-blank line names an agent:

```text
/orchestrator

Build a plan to split this task into sub-issues.
```

You have succeeded when `Atomaton Entry` routes to `atomaton-runner`, the issue carries
`atomaton/in-progress` while the run is going, and the agent comments back.

## Where to go next

Everything below is indexed in [docs/README.md](docs/README.md), which says where a page lives and why.

| You want to | Go to |
| --- | --- |
| put this into a repository | [Setup](docs/setup.md) — everything you do first, in order |
| know what a setting does | [What `config.yaml` accepts](docs/config/reference.md) — every key, and where its entry is |
| do one specific thing | [The map](docs/README.md) — a table indexed by what you want to change |
| understand what it just did | [What starts a run](docs/work/how-it-works/what-starts-a-run.md), and [when it breaks](docs/README.md) — the map indexes those by symptom |
| write an MCP server for it | [Writing a tool](docs/tools/tasks/write-a-tool.md) |
| know why it is built this way | [Environment-Driven Development](docs/method/edd.md) — the idea the whole system is an argument for |
| change the template itself | [CONTRIBUTING.md](CONTRIBUTING.md), then [Architecture](docs/template/architecture.md) — the layers, and where a module belongs |

Paths are conventions rather than settings, and `.github/atomaton/README.md` — which
ships with the deliverable — says what each one holds and why.

## What this costs you, and what bounds it

Two pages answer that, and they answer it once:
[what bounds a run, and who may start one](docs/work/boundaries.md), and
[what the merge gate stops](docs/pull-requests/boundaries.md). What an agent's tools
can and cannot reach is
[a third](docs/tools/boundaries.md).

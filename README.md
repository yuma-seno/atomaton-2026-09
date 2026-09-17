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

Then commit it, and do the four things in **[Setup](docs/setup.md)** — the first run
needs a repository setting and a credential, and will not start without them.

With those done, open an issue whose first non-blank line names an agent:

```text
/orchestrator

Build a plan to split this task into sub-issues.
```

You have succeeded when `Atomaton Entry` routes to `atomaton-runner`, the issue carries
`atomaton/in-progress` while the run is going, and the agent comments back.

## Where to go next

| You want to | Go to |
| --- | --- |
| put this into a repository | [Setup](docs/setup.md) — everything you do first, in order |
| know what a setting does | [Configuration](docs/configuration.md) — every key, and the measurements behind the numbers |
| do one specific thing | [Recipes](docs/recipes.md) — indexed by the goal you arrived with |
| understand what it just did | [Operations](docs/operations.md) — how a run works, and how to diagnose one |
| write an MCP server for it | [Writing a tool](docs/writing-a-tool.md) |
| know why it is built this way | [Environment-Driven Development](docs/edd.md) — the idea the whole system is an argument for |
| change the template itself | [CONTRIBUTING.md](CONTRIBUTING.md) |

Paths are conventions rather than settings, and `.github/atomaton/README.md` — which
ships with the deliverable — says what each one holds and why.

## What this costs you, and what bounds it

- A run is bounded by its job: sixty minutes, less five reserved for reporting
  whatever it had reached.
- A chain of runs is bounded by two counters, `chain.after_handoffs` and
  `chain.after_runs_without_change`. **There is no token or cost ceiling** — the
  bounds are on how many runs happen, not on what they spend.
- Validation hands a pull request back to the engineer at most three times.
- An agent will not merge a change to how agents themselves run. It reviews and
  reports; that merge is yours.

[Operations](docs/operations.md) has the rest, including what an agent's tools can
and cannot reach.

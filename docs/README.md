# Documentation

Two questions decide where anything here lives, and neither of them is who you are.

**Which artifact is it about** — a thing you hold: `config.yaml`, an agent definition,
a skill, a tool server, your pipeline, a pull request, the environment a run works in,
the records a run leaves, the settings on GitHub itself, the generated runtime. That is
the directory.

**What kind of question is it** — how it works, what the keys are, how to do one
thing, what to do when it breaks, what it does and does not protect. That is the file.

The reader is not an axis on purpose. The same person adopts on Monday and contributes
on Friday, and a page like "what the merge gate stops" answers an operational question
and a design question at once. Split by reader and such a page either gets written
twice or disappears from one shelf.

## By what you want to change

| You want to | What you change |
| --- | --- |
| [run an agent on a different model](agents/tasks/run-an-agent-on-a-different-model.md) | `model`, in an agent definition |
| [have a screenshot reach an agent as a picture](agents/tasks/have-a-screenshot-reach-an-agent-as-a-picture.md) | `vision`, in an agent definition |
| [switch between the Chat Completions and Responses APIs](agents/tasks/switch-between-the-chat-completions-and-responses-apis.md) | `provider`, in an agent definition |
| [reach a provider the table does not list](agents/tasks/reach-a-provider-the-table-does-not-list.md) | the `OPENAI_BASE_URL` repository variable |
| [prefer particular upstream providers](agents/tasks/prefer-particular-upstream-providers.md) | `extra_body`, in an agent definition |
| [give a repository a pipeline an agent can write and maintain](pipeline/tasks/give-a-repository-a-pipeline-an-agent-can-write-and-maintain.md) | `checks.from_pull_request` and `deploy.on_merge` |
| [have agents start your own CI and deployment](pipeline/tasks/have-agents-start-your-own-ci-and-deployment.md) | `checks.your_workflow` and `deploy.your_workflow` |
| [make a workflow of your own work when Atomaton starts it](pipeline/tasks/make-a-workflow-of-your-own-work-when-atomaton-starts-it.md) | `workflow_dispatch`, in that workflow |
| [check your config before pushing it](config/tasks/check-your-config-before-pushing-it.md) | nothing — one command |
| [keep some paths for human review](pull-requests/tasks/keep-some-paths-for-human-review.md) | `merge.governed_paths` |
| [let agents merge their own pull requests](pull-requests/tasks/let-agents-merge-their-own-pull-requests.md) | `merge.policy` |
| [stop an agent loop that is going nowhere](work/tasks/stop-an-agent-loop-that-is-going-nowhere.md) | `chain.after_handoffs`, `chain.after_runs_without_change` |
| [use your own label names](work/tasks/use-your-own-label-names.md) | `chain.labels` |
| [let a tool server reach something outside GitHub](tools/tasks/let-a-tool-server-reach-something-outside-github.md) | `tools.secrets`, then that server's own environment |
| [let a tool run longer than a minute](tools/tasks/let-a-tool-run-longer-than-a-minute.md) | `request_timeout_secs`, on that server |
| [change or remove web fetching and search](tools/tasks/change-or-remove-web-fetching-and-search.md) | the `research/web-search` skill |
| [write a tool of your own](tools/tasks/write-a-tool.md) | a new MCP server |
| [move to a newer release](runtime/tasks/move-to-a-newer-release.md) | nothing — a vendoring procedure |
| [have something happen every week](work/tasks/have-something-happen-every-week.md) | a workflow you copy in |

## By what you have in front of you

If you know the key and not the artifact,
[what `config.yaml` accepts](config/reference.md) is the one page that knows both.

**`config/`** — the file you edit.
[What `config.yaml` accepts](config/reference.md) ·
[When your config is wrong](config/when-it-breaks.md)

**`agents/`** — an agent definition, and what it reaches its provider with.
[What an agent definition is](agents/overview.md) ·
[Every setting in one](agents/reference.md) ·
[What it may not reach](agents/boundaries.md)

**`environment/`** — the runner every job starts on.
[The environment a run works in](environment/reference.md)

**`pipeline/`** — your checks and your deployments.
[The pipeline as commands](pipeline/overview.md) ·
[`checks` and `deploy`](pipeline/reference.md) ·
[Which ref a pipeline is read from](pipeline/how-it-works.md) ·
[What a check and a deployment refuse to do](pipeline/boundaries.md)

**`pull-requests/`** — the gate between an agent's work and your default branch.
[`merge`](pull-requests/reference.md) ·
[What the merge gate stops](pull-requests/boundaries.md)

**`work/`** — an issue, the branch it becomes, and the chain of runs on it.
[Where work branches from, and when a chain stops](work/reference.md) ·
[Why there are two counters](work/how-it-works.md)

**`tools/`** — what an agent can reach, and under what watch.
[What an agent can reach](tools/overview.md) ·
[`tools`](tools/reference.md) ·
[What routing a credential protects](tools/boundaries.md) ·
[When a tool server goes wrong](tools/when-it-breaks.md) ·
[The tools file](tools/how-it-works/the-tools-file.md) ·
[Where a server is read from](tools/how-it-works/where-a-server-is-read-from.md) ·
[How a credential reaches a tool](tools/how-it-works/routing-a-credential.md) ·
[How long a tool has to answer](tools/how-it-works/how-long-a-tool-has.md) ·
[How the issue search ranks](tools/how-it-works/how-the-issue-search-ranks.md)

**`runtime/`** — the half of the deliverable you do not edit.
[What an upgrade replaces, and what is yours](runtime/boundaries.md)

## Read through, rather than looked up

| | |
| --- | --- |
| [Setup](setup.md) | Getting from an empty repository to a first agent run. Read it through; do each step as you reach it. |
| [Operations](operations.md) | What actually happens when work starts, and what bounds it. |
| [Environment-Driven Development](method/edd.md) | The idea the rest of this is an argument for. Nothing in it is a setting. |
| [Architecture](template/architecture.md) | The template's own source. An adopted repository receives `.github/`, never `src/`, so no path named there exists in it. |

## What is not here yet

The tree has room for an `overview.md`, a `reference.md`, a `when-it-breaks.md` and a
`boundaries.md` under each artifact, and most do not exist. `operations.md` and
`setup.md` are still the single large files they always were, and several entries above
point into them.

A page here is written when somebody needs it, not to fill a slot. An empty page answers
a question nobody asked and then goes stale unread.

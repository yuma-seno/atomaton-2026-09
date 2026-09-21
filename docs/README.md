# Documentation

Two questions decide where anything here lives, and neither of them is who you are.

**Which artifact is it about** — a thing you hold: `config.yaml`, an agent definition,
a skill, a tool server, your pipeline, a pull request, the records a run leaves, the
settings on GitHub itself, the generated runtime. That is the directory.

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

## By what you want to understand

| | |
| --- | --- |
| [Setup](setup.md) | Getting from an empty repository to a first agent run. Read it through; do each step as you reach it. |
| [Configuration](configuration.md) | Every key, one entry each. Look things up in it — it is not written to be read through. |
| [Operations](operations.md) | What actually happens when work starts, and what bounds it. |
| [How long a tool has to answer](tools/how-it-works/how-long-a-tool-has.md) | The response budget, and what a tool should do when it runs out. |
| [When a tool answers worse than it should](tools/when-it-breaks.md) | A tool that starts, replies, and is wrong. |
| [Environment-Driven Development](method/edd.md) | The idea the rest of this is an argument for. Nothing in it is a setting. |
| [Architecture](template/architecture.md) | The template's own source. An adopted repository receives `.github/`, never `src/`, so no path named there exists in it. |

## What is not here yet

The tree has room for an `overview.md`, a `reference.md`, a `when-it-breaks.md` and a
`boundaries.md` under each artifact. Most do not exist. `configuration.md`,
`operations.md` and `setup.md` are still the single large files they always were, and
the entries above point into them.

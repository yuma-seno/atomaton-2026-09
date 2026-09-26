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

Two pages stand at the root, and they are the two that are about no artifact. This one
says where everything is. [Setup](setup.md) says what to do first, and in what order —
an ordered path from an empty repository to a first agent run. Everything that answers
a question about one artifact is in the tree below. Setup carries actions and links
only: the reason behind a step is at the other end of that step's link.

## By what you want to change

| You want to | What you change |
| --- | --- |
| [run an agent on a different model](agents/tasks/run-an-agent-on-a-different-model.md) | `model`, in an agent definition |
| [add an agent of your own](agents/tasks/add-an-agent-of-your-own.md) | a new file under `agent-definitions/` |
| [write a skill](agents/tasks/write-a-skill.md) | a new file under `skills/` |
| [have a screenshot reach an agent as a picture](agents/tasks/have-a-screenshot-reach-an-agent-as-a-picture.md) | `vision`, in an agent definition |
| [switch between the Chat Completions and Responses APIs](agents/tasks/switch-between-the-chat-completions-and-responses-apis.md) | `provider`, in an agent definition |
| [reach a provider the table does not list](agents/tasks/reach-a-provider-the-table-does-not-list.md) | the `OPENAI_BASE_URL` repository variable |
| [move to a different provider](agents/tasks/move-to-a-different-provider.md) | `provider` in every agent definition, and that provider's own secret |
| [prefer particular upstream providers](agents/tasks/prefer-particular-upstream-providers.md) | `extra_body`, in an agent definition |
| [give a repository a pipeline an agent can write and maintain](pipeline/tasks/give-a-repository-a-pipeline-an-agent-can-write-and-maintain.md) | `checks.from_pull_request` and `deploy.on_merge` |
| [have agents start your own CI and deployment](pipeline/tasks/have-agents-start-your-own-ci-and-deployment.md) | `checks.your_workflow` and `deploy.your_workflow` |
| [make a workflow of your own work when Atomaton starts it](pipeline/tasks/make-a-workflow-of-your-own-work-when-atomaton-starts-it.md) | `workflow_dispatch`, in that workflow |
| [check your config before pushing it](config/tasks/check-your-config-before-pushing-it.md) | nothing — one command |
| [keep some paths for human review](pull-requests/tasks/keep-some-paths-for-human-review.md) | `merge.governed_paths` |
| [let agents merge their own pull requests](pull-requests/tasks/let-agents-merge-their-own-pull-requests.md) | `merge.policy` |
| [stop a run and pick it up again](work/tasks/stop-a-run-and-pick-it-up-again.md) | nothing — `/stop`, then `/resume` |
| [close an issue a run is working on](work/tasks/close-an-issue-a-run-is-working-on.md) | nothing — closing it is the command |
| [start an agent again from a clean session](work/tasks/start-an-agent-again-from-a-clean-session.md) | nothing — one modifier on the command |
| [stop an agent loop that is going nowhere](work/tasks/stop-an-agent-loop-that-is-going-nowhere.md) | `chain.after_handoffs`, `chain.after_runs_without_change` |
| [use your own label names](work/tasks/use-your-own-label-names.md) | `chain.labels` |
| [let a tool server reach something outside GitHub](tools/tasks/let-a-tool-server-reach-something-outside-github.md) | `tools.secrets`, then that server's own environment |
| [let a tool run longer than a minute](tools/tasks/let-a-tool-run-longer-than-a-minute.md) | `request_timeout_secs`, on that server |
| [change or remove web fetching and search](tools/tasks/change-or-remove-web-fetching-and-search.md) | the `research/web-search` skill |
| [change what a delegate may reach](tools/tasks/change-what-a-delegate-may-reach.md) | the `servers:` block in its tools file |
| [write a tool of your own](tools/tasks/write-a-tool.md) | a new MCP server |
| [make a branch ruleset work with agents](github/tasks/make-a-branch-ruleset-work-with-agents.md) | a server-side setting on GitHub, declared by `.github/atomaton/rulesets/main.json` |
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
[What it may not reach](agents/boundaries.md) ·
[When an agent will not start](agents/when-it-breaks.md)

**`environment/`** — the runner every job starts on.
[The environment a run works in](environment/reference.md) ·
[When the environment is missing something](environment/how-it-works.md)

**`pipeline/`** — your checks and your deployments.
[The pipeline as commands](pipeline/overview.md) ·
[`checks` and `deploy`](pipeline/reference.md) ·
[Which ref a pipeline is read from](pipeline/how-it-works.md) ·
[What a check and a deployment refuse to do](pipeline/boundaries.md)

**`pull-requests/`** — the gate between an agent's work and your default branch.
[`merge`](pull-requests/reference.md) ·
[What an agent's pull request meets](pull-requests/how-it-works.md) ·
[What the merge gate stops](pull-requests/boundaries.md) ·
[When a pull request will not merge](pull-requests/when-it-breaks.md)

**`work/`** — an issue, the branch it becomes, and the chain of runs on it.
[Where work branches from, and when a chain stops](work/reference.md) ·
[What bounds a run, and who may start one](work/boundaries.md) ·
[When a run does not start, or does not stop](work/when-it-breaks.md) ·
[What starts a run](work/how-it-works/what-starts-a-run.md) ·
[GitHub raises no event for its own token](work/how-it-works/github-raises-no-event-for-its-own-token.md) ·
[The branch a run commits to](work/how-it-works/the-branch-a-run-commits-to.md) ·
[What keeps two runs off one issue](work/how-it-works/what-keeps-two-runs-off-one-issue.md) ·
[The labels Atomaton applies](work/how-it-works/the-labels-atomaton-applies.md) ·
[Work is a tree of issues](work/how-it-works/work-is-a-tree-of-issues.md) ·
[Two comments, and why they are not the same one twice](work/how-it-works/the-two-comments-a-stop-leaves.md) ·
[Why there are two counters](work/how-it-works/why-there-are-two-counters.md)

**`records/`** — the session and the working files a run leaves behind.
[What a run leaves behind](records/how-it-works.md) ·
[What a record does not keep](records/boundaries.md)

**`tools/`** — what an agent can reach, and under what watch.
[What an agent can reach](tools/overview.md) ·
[`tools`](tools/reference.md) ·
[What routing a credential protects](tools/boundaries.md) ·
[When a tool server goes wrong](tools/when-it-breaks.md) ·
[The tools file](tools/how-it-works/the-tools-file.md) ·
[Where a server is read from](tools/how-it-works/where-a-server-is-read-from.md) ·
[How a credential reaches a tool](tools/how-it-works/routing-a-credential.md) ·
[How long a tool has to answer](tools/how-it-works/how-long-a-tool-has.md) ·
[Searching your repository's issues](tools/how-it-works/searching-the-issues.md) ·
[How the issue search ranks](tools/how-it-works/how-the-issue-search-ranks.md) ·
[Reading the web](tools/how-it-works/reading-the-web.md) ·
[Delegating a piece of work](tools/how-it-works/delegating-a-piece-of-work.md)

**`github/`** — the settings on GitHub itself, which nothing in `config.yaml` reaches.
[What GitHub's own settings protect](github/boundaries.md) ·
[When a check will not settle](github/when-it-breaks.md)

**`runtime/`** — the half of the deliverable you do not edit.
[What an upgrade replaces, and what is yours](runtime/boundaries.md)

## By what went wrong

The symptom is the only thing you have at this point, so it is the column you read.
The cause and what to do about it are on the page, once.

| What you see | Where it is answered |
| --- | --- |
| Workflow ran but agent did not start | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Nothing happened at all when an issue or comment asked for an agent | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Manual command reports invalid syntax | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Comment disappeared during run | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| `atomaton/in-progress` label remains | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Repeated handoffs stop automatically | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Agent repeatedly reproduces stale or invalid tool behaviour | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Parent atomaton not re-invoked after sub-issue completion | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| A handoff names the next agent but no run starts | [When a run does not start, or does not stop](work/when-it-breaks.md) |
| Agent exits immediately with a provider error | [When an agent will not start](agents/when-it-breaks.md) |
| `More than one provider credential is set` | [When an agent will not start](agents/when-it-breaks.md) |
| Draft pull request will not merge | [When a pull request will not merge](pull-requests/when-it-breaks.md) |
| Required check goes red and your CI never ran | [When a pull request will not merge](pull-requests/when-it-breaks.md) |
| An agent's pull request shows a check stuck at `action_required` | [When a check will not settle](github/when-it-breaks.md) |
| A required check never fills on an agent's pull request | [When a check will not settle](github/when-it-breaks.md) |
| Agent reports a missing dependency instead of installing it | [When the environment is missing something](environment/how-it-works.md) |
| A run takes longer, or costs more, than you expected | [When a tool server goes wrong](tools/when-it-breaks.md) |

## Read through, rather than looked up

| | |
| --- | --- |
| [Environment-Driven Development](method/edd.md) | The idea the rest of this is an argument for. Nothing in it is a setting. |
| [Architecture](template/architecture.md) | Atomaton's own source tree — the one page here whose subject is the template rather than your repository. Nothing it names is in yours. |

## What is not here yet

Nothing above is a large flat file any more, and no entry points into one. What is
missing is pages, not shape.

The tree has room for an `overview.md`, a `reference.md`, a `when-it-breaks.md` and a
`boundaries.md` under each artifact, and only `agents/` and `tools/` have all four.
`work/` and `pull-requests/` have no `overview.md`; `pipeline/` has no `when-it-breaks.md`;
`config/`, `environment/`, `github/`, `records/` and `runtime/` are each two or three
short. There is no `skills/` directory of its own — what a skill is, which of them are
yours, and how to write one is [write a skill](agents/tasks/write-a-skill.md), and
`.github/atomaton/README.md` says which directories the template ships.

A page here is written when somebody needs it, not to fill a slot. An empty page answers
a question nobody asked and then goes stale unread, and a slot is not a question: an
absent page is the honest state, and a placeholder written so the tree looks finished
is worse than the gap it hides.

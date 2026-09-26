# Add an agent of your own

The three that ship are a template. An agent exists exactly when a definition for
it does, so adding one is a new file under
`.github/atomaton/agent-definitions/` — nothing else registers it, and nothing
counts how many there are.

## The file

`<name>.md`, where `<name>` is what `/<name>` dispatches. It must be a name a
control command does not already use — `/stop` and `/resume` are taken, and a
definition named one of those fails the pull request's own check.

```markdown
---
name: triager
description: Sorts incoming issues into the ones that are ready and the ones that need a decision.
provider: orcarouter-responses
model: deepseek/deepseek-v4.1-flash
vision: true
knows_about:
  - atomaton
  - engineer
mcp_servers:
  - files_readonly
  - github
  - search
---

You sort incoming issues. ...
```

The frontmatter is [every setting in an agent definition](../reference.md); the body
below it is the role prompt, placed inside
[the shared template](../overview.md) at `{{AGENT_ROLE_PROMPT}}`.

## What to decide

**Which servers it gets.** `mcp_servers` is the whole of its reach — an agent
receives the servers it names and no others. An agent that must not change the
tree names `files_readonly` rather than `files`; one that must not close its own
issue names `atomaton_env` rather than `atomaton`. [What an agent can
reach](../../tools/overview.md) is the set to choose from.

**Who it may hand work to.** `knows_about` is the colleague list the prompt
renders, and the list a handoff line is written from. An agent absent from it is
one this agent cannot name.

**Whether it needs a skill.** A procedure that only some work needs belongs in
`skills/`, loaded on demand, rather than in the role prompt every run carries.
[Write a skill](write-a-skill.md).

## What it inherits

Everything in `prompt-template.md` — how a run works, the report contract, the
shared exits, the directive line — arrives with the definition and does not need
restating. The role prompt says what is particular to this agent: what it is for,
what it must not do, and which outcome ends a run for each situation it meets.

## Checking it

`atoma validate --agent-def <name>.md --tools-file <tools.yaml>` resolves every
`mcp_servers` and `knows_about` name the way a run would. The pull request's own
check runs it for you, so a name that resolves to nothing is reported before
anything is merged rather than on the first run that names the agent.

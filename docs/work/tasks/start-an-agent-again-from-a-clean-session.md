# Start an agent again from a clean session

When an agent keeps reproducing behaviour that is no longer true — a tool that has
changed, a plan it abandoned three runs ago — what is wrong is the conversation it
restores, not the issue. Say so on its own line:

```text
/engineer recover
Continue from the current Issue, repository, pull request, and CI state.
```

`recover` archives the previous session, does **not** restore its assistant and tool
history, rebuilds a fresh one from the current GitHub events, and then runs the named
agent. Repository branches and GitHub state are not reset — this changes what the
agent remembers and nothing else. Atomaton's own dispatches never do this; they
continue the existing session.

It is the only modifier, and only in a comment: a new issue's first line takes a bare
agent name and nothing else.

The archived session is kept beside the live one rather than deleted —
[what a run leaves behind](../../records/how-it-works.md).

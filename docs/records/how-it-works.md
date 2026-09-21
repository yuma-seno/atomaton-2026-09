# What a run leaves behind

Two things outlive a run, and both live on the `atomaton-data` branch rather than in
your repository: the session an agent restores next time, and the working directory
it kept its notes in.

## The session

- Active sessions are stored by context and agent: `sessions/<type>-<number>/<agent>.json`.
- Recovery archives are stored beside the active sessions as `sessions/<type>-<number>/archive/<agent>-N.json`, where `N` is the next per-agent sequence number.
- Restore uses `git fetch` and `git show` from `origin/atomaton-data`, without changing
  the checkout a run is working in.
- Save uses an isolated git worktree and a push-retry loop, so two runs finishing at
  once do not lose one another's writes.
- **A session is saved whatever ended the run**, including a failure. What this run
  worked out is still there;
  [starting again from a clean session](../work/tasks/start-an-agent-again-from-a-clean-session.md)
  archives it and rebuilds one when that is what you want. The choice belongs to a
  person, not to the machinery.

## Where an agent puts its working files

Notes, a script to check something, an intermediate dump — an agent writes these on
the way to an implementation, and they do not belong in your repository.

`/tmp/atomaton-workspace` is where they go. It is restored at the start of every run
on an issue and saved at the end, so a file left there is available to the next run
and to the other agents working on the same issue. Sub-issues and the pull request
share the root issue's workspace, because that is one piece of work even though it
is several GitHub objects.

**Nothing to configure and nothing to add to `.gitignore`.** It is outside the
repository, so `git add -A` never sees it.

The rule an agent is given is one sentence, and it is the reason this is a
directory rather than a pair of "stash this" / "fetch that" tools:

> Everything in the repository is part of the work. Anything under
> `/tmp/atomaton-workspace` survives; nothing else outside the repository does.

A tool pair would make the agent remember which side each file is on — two verbs
and a piece of state held in the model's head rather than visible in the path it
types. A directory puts that state in the string it already writes, and lets it
read, write and *run* those files with the tools it already has.

What neither of these keeps is
[what a record does not keep](boundaries.md).

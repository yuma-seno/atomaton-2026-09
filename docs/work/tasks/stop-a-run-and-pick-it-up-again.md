# Stop a run and pick it up again

`/stop` on its own line stops the agent currently running on that issue or pull
request. `/resume` continues it.

```text
/stop
```

Three things are worth knowing about it.

**It is not immediate.** The running job polls for the request every 30 seconds, and
the agent stops at its next turn — so it can finish the tool call it is in and start
one more. Expect up to a minute or two. The comment Atomaton posts in reply says this,
because a command that appears to do nothing looks broken.

**Nothing is lost.** The agent stops between turns, where the conversation is
complete, and writes its session before exiting. This is the whole reason `/stop`
exists rather than a note saying "cancel the workflow run": a cancelled job never
reaches the step that saves the session, so cancelling means discarding.

**Your `/stop` comment is deleted.** It must not become part of what the agent reads
when it resumes — a paused run is not a run that was told something. Atomaton's reply
carries the record of who asked and when, and is itself excluded from the agent's
context.

A stopped run has ended and handed back to a person, which is the same terminal
state as an agent that finished its turn or ran out of time. So the `atomaton/in-progress`
label comes off, nothing is dispatched next, and the issue is open for comment again.
There is no separate "paused" state to get stuck in.

To continue:

| | |
| --- | --- |
| `/resume` | continue with the same agent and the saved session, carrying no new instruction |
| `/<agent>` + instructions on the following lines | continue with an instruction of your own, which is what to use when you stopped the run because it was going the wrong way |

`/resume` finds the agent from the last one that ran here, so there is nothing to
remember. It takes no instruction of its own — the ordinary agent command already
does that, and having two ways to say it would only make one of them wrong.

**On a parent issue.** It reaches the work underneath. An orchestrator's sub-issues
and the pull requests opened for them are all under the issue you named, so one
`/stop` holds the whole chain, and the reply lists what it reached. `/resume` on the
same issue brings all of it back.

That is the model rather than a convenience:
[work is a tree of issues](../how-it-works/work-is-a-tree-of-issues.md), and both
stop and close act on the node you name and everything under it. What separates them
is finality, not reach —
[close an issue a run is working on](close-an-issue-a-run-is-working-on.md).

Why two comments arrive seconds apart, and which of them to read, is
[the two comments a stop leaves](../how-it-works/the-two-comments-a-stop-leaves.md).

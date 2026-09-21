# Work is a tree of issues

An orchestrator files sub-issues under the issue it was given; an engineer opens a
pull request under the issue it delivers. Each of those is a node, each has at most
one parent, and a pull request is a leaf.

You act on a node and mean the work under it, so both commands reach the whole
subtree:

| | reach | ending | undone by |
| --- | --- | --- | --- |
| `/stop` | the node and everything under it | held | `/resume` over the same subtree |
| close | the node and everything under it | over | nothing; reopening is not undo |

**They differ in finality, not in reach.** Stop holds the work; close ends it.

There used to be an asymmetry here, and it showed up as a checklist: a `/stop` on a
parent listed the sub-issues it had not reached and asked you to go and stop each one.
That was the machinery turning the narrowness of its own vocabulary into your manual
work.

**Nothing is stored.** A node is resumable when it is open, nothing is running on it,
and its last run ended on a stop — all readable from the tree and the thread. So
`/resume` does not replay a record of what a `/stop` covered; it asks the same
question again. There is still no paused state to get stuck in.

**A merged pull request has left the tree.** GitHub cannot reopen one, so there is
nothing there to stop and nothing to close, and a close passes over it.

The two commands themselves are
[stop a run and pick it up again](../tasks/stop-a-run-and-pick-it-up-again.md) and
[close an issue a run is working on](../tasks/close-an-issue-a-run-is-working-on.md).

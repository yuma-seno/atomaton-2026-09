# When a run does not start, or does not stop

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Workflow ran but agent did not start | The route step produced an empty `agent` output | Check the slash command on the issue's first visible line; that is the only thing that names an agent |
| Nothing happened at all when an issue or comment asked for an agent | Whoever triggered it is not a repository member — only `OWNER`, `MEMBER` and `COLLABORATOR` dispatch a run | A member comments `/<agent>` on the issue. This is by design; see [who may start one](boundaries.md#who-may-start-one) |
| Manual command reports invalid syntax | Instruction text was placed on the `/agent` line, or an unsupported modifier was used | Use a standalone `/<agent>` line, or `/<agent> recover`; put instructions on the lines below it |
| Comment disappeared during run | The in-progress guard deleted it, because it would otherwise have reached the running agent mid-turn — [what keeps two runs off one issue](how-it-works/what-keeps-two-runs-off-one-issue.md) | Post it again once the run ends |
| `atomaton/in-progress` label remains | The chain is still continuing, or the step that releases the guard was skipped by an upstream failure | Read the `Decide how this turn ended` step's output, fix the failure above it, and rerun |
| Repeated handoffs stop automatically | One of the two chain limits fired — [what bounds a chain of runs](boundaries.md#what-bounds-a-chain-of-runs) | Read `stop_reason`, which says which one. Then comment the next agent's name to carry on |
| Agent repeatedly reproduces stale or invalid tool behaviour | [The session it restores](../records/how-it-works.md) is no longer worth restoring | [Start it again from a clean session](tasks/start-an-agent-again-from-a-clean-session.md) |
| Parent orchestrator not re-invoked after sub-issue completion | A sibling is still open, or another path already aggregated | Check the siblings' labels and the parent's comments for the marker. A sibling counts only while it carries both `atomaton/sub-issue` and `atomaton/launched` — [how a parent learns its children are done](how-it-works/the-labels-atomaton-applies.md#how-a-parent-learns-its-children-are-done) |
| A handoff names the next agent but no run starts | The target issue or pull request is closed, and a merged pull request counts as closed | Read the notice on that target, then reopen it and comment the agent's name — or open an issue instead, when the target is a merged pull request. See below |

## Commands and dispatches on something already closed

**A slash command on a closed issue or pull request does not run.** Atomaton replies
naming the command that did not run and what to do: reopen and comment again. A
merged pull request gets different advice, because GitHub cannot reopen one — open
an issue for the follow-up instead.

Your comment is left where it is. The in-progress guard deletes what it catches
because that comment would otherwise reach a running agent; nothing is running here,
so there is nothing to keep it out of.

`/stop` is exempt, for the same reason it is exempt from the other guard: an agent
can close its own issue and keep working, so a closed issue can still have a run on
it.

**Atomaton's own handoffs are refused the same way**, and this is the case that
costs something. When an orchestrator's last sub-issue lands, its parent is
re-invoked — and if somebody closed that parent meanwhile, nothing starts. The
notice says what was about to happen, that nothing will retry it, and how to run it
by hand. It mentions whoever asked for the run in the first place, which is the
login the chain has been carrying all along.

A target whose state cannot be read is treated as closed rather than as open. Work
that should not have started is harder to undo than work that has to be started
again.

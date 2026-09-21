# What keeps two runs off one issue

One issue or pull request holds one run. The runner takes a workflow concurrency
group per `<type>-<number>`, so a second dispatch for the same node waits rather
than starting beside the first, and the `atomaton/in-progress` label goes on before
the agent starts so that the state is visible without reading the Actions tab —
[the labels Atomaton applies](the-labels-atomaton-applies.md).

The label comes off when the work hands back to a person. Which endings count as
handing back is a rule of the machinery rather than a condition written into a
workflow, so every path out of a run releases the guard the same way.

**A comment made while a run is going is deleted.** It would otherwise reach the
agent mid-turn as though it had been part of the conversation all along, so the
machinery removes it and tells whoever wrote it to say it again once the run ends.

`/stop` is the one exemption, and it has to be: its whole meaning is "act on the
run happening right now", so guarding it would make it unusable exactly when it is
needed — [stop a run and pick it up again](../tasks/stop-a-run-and-pick-it-up-again.md).

# Close an issue a run is working on

**Closing it stops the run.** It did not use to: the run kept going, and one of them
went on for five more minutes and opened a pull request nobody was waiting for. So
closing now posts the same stop request `/stop` does, and Atomaton replies saying so.

The issue stays closed. Nothing reopens it for you — closing is your decision, and
a machine that undid it would be arguing rather than reporting. To pick the work
back up, reopen the issue and comment `/resume`.

**And it reaches the work underneath.** The sub-issues and pull requests under the
one you closed are closed with it, and any run on them is asked to stop. Closing is
the end of a line of work, not of one node; a closed issue with an open pull request
still claiming to deliver it is the state this avoids. The reply names what it
closed.

Everything true of
[`/stop`](stop-a-run-and-pick-it-up-again.md) is true here: it takes up to a minute
or two, the session is saved, and sub-issues running under a closed parent are named
in the reply but not stopped.

A command you post on something already closed does not run, and neither does a
handoff aimed at it —
[commands and dispatches on something already closed](../when-it-breaks.md#commands-and-dispatches-on-something-already-closed).

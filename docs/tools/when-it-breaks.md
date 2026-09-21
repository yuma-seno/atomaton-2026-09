# When a tool server goes wrong

## A name that is not a server

The servers a run starts must cover the union of `mcp_servers` across every agent
definition. A name that is neither shipped nor added under `tools.servers` aborts
the run before any MCP server starts — `Tool 'X' not found in tools file` — and
`atoma` lists the servers that do exist beside that error.

It does not usually get that far. The check on every pull request resolves the
same names against the same set, so a definition naming a server nothing provides
is reported on the pull request rather than on whoever triggered the next run —
[what a pull request is checked against](../pull-requests/boundaries.md#what-a-pull-request-is-checked-against).

## A tool that answers worse than it should

A tool that fails returns an error and the agent sees it. A tool that **degrades**
returns an answer that looks like any other, and nothing says otherwise. That is
what the shipped `search` server did: its reranker failed to load, every search
answered with first-stage ordering, and nothing in the result said so — so nobody
noticed.

So a server says so, and Atoma attaches what it says to that server's next tool
result:

```
search__search_issues → [results]

--- 1 problem reported by the 'search' server, not part of the answer above ---
warning: reranking failed (EACCES); these results are first-stage ordered, not reranked
```

The servers under `.github/atomaton-runtime/tools/mcp/` already do this — they arrive
as bundles with the reporting helper inside them, so there is nothing to wire and no
file to edit. For a server of your own, the protocol form is at the end of this
section.

It goes out as MCP `notifications/message`, which `serveMcpServer` enables by
declaring the `logging` capability. A report made before the server has connected —
during a model load, say — is held and sent once it has.

**What belongs there is what changed about the answer, not that something
happened.** Either the answer is worse than it should have been, or the same thing
will happen on the next call. A failure the result already describes is not a
report: the agent is being told once, and twice in two shapes is noise it has to
read past.

`log()` is the other channel and it has not changed: it is for a person reading
the run afterwards. One rule about it, though —

> **A log line must not contain `warn`, `error`, `fatal` or `panic`.**

Atoma reads a spawned server's stderr as a *fallback* for servers that implement no
logging capability, and guesses severity from exactly those words. A log line
carrying one is promoted in front of the agent as a problem whether or not it is
one.

That is not a house style you can decline. The word-matching happens at run time,
to your server, in whichever repository it lives, and nothing checks your `log()`
text for those words before it gets there.

For a server of your own: declare `logging` in your `initialize` result and send
`notifications/message` with a `level` of `warning` or `error`. If you do
neither, Atoma falls back to reading your stderr, and the word-matching above is
what you get.

## A run that takes longer, or costs more, than you expected

Usually one of two things: a high number of shell round trips, or a few very large
tool results. Both are readable. Every shell call writes an `[atomaton-shell]` line
into the workflow log with the command, its exit code, how long it took and how many
bytes it returned, so the expensive call is the one you can see rather than the one
you guess at. What happens to a result too large to pass on is
[how much a shell command may print](boundaries.md#what-a-shell-command-may-print).

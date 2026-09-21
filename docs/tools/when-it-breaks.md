# When a tool server goes wrong

## A name that is not a server

The servers a run starts must cover the union of `mcp_servers` across every agent
definition. A name that is neither shipped nor added under `tools.servers` aborts
the run before any MCP server starts — `Tool 'X' not found in tools file` — and
`atoma` lists the servers that do exist beside that error.

It does not usually get that far. The check on every pull request resolves the
same names against the same set, so a definition naming a server nothing provides
is reported on the pull request rather than on whoever triggered the next run —
[what a pull request is checked against](../operations.md#what-a-pull-request-is-checked-against).

## A tool that answers worse than it should

A tool that fails returns an error and the agent sees it. A tool that **degrades**
returns an answer that looks like any other, and nothing says otherwise. That
happened here: the search server's reranker failed to load, every search answered
with first-stage ordering, and two releases went out before anyone noticed.

So a server says so, and Atoma attaches what it says to that server's next tool
result:

```
search__search_issues → [results]

--- 1 problem reported by the 'search' server, not part of the answer above ---
warning: reranking failed (EACCES); these results are first-stage ordered, not reranked
```

In one of the servers in this template, that is one call:

```ts
import { report } from "../../../lib/mcp-report.ts";

report("warning", "could not save the search index; every search from here rebuilds it");
```

That import is this template's own source layout: `src/adapters/mcp/mcp-report.ts`, reached
from `src/entrypoints/tools/mcp/`. The servers an adopted repository receives are
bundles with the helper already inside them, so there is no file at that path to
import — what the deliverable carries is the behaviour, not the module. For a
server that is not built in this tree, see the protocol form at the end of this
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
to your server, in whichever repository it lives. What is local to this template is
the *enforcement*: `tests/contract/server-reports.test.ts` fails a shipped server
whose `log()` text carries one of those words. An adopted repository does not
receive that test — it has the same rule and nothing that checks it.

For a server of your own that is not written against this repository's helpers:
declare `logging` in your `initialize` result and send
`notifications/message` with a `level` of `warning` or `error`. If you do
neither, Atoma falls back to reading your stderr, and the word-matching above is
what you get.

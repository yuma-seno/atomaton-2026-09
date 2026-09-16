# Writing a tool

This page is for somebody writing or changing an MCP server — one for this
template, or one for a repository of your own.

Where a path below begins `src/` or `tests/`, it belongs to this template's own
source tree. An adopted repository does not receive those directories. It receives
`.github/atomaton/**`, which is its own, and `.github/atomaton-runtime/**`, which is
Atoma's — and the servers under `.github/atomaton-runtime/tools/mcp/` are bundles,
with the helpers named here already inside them. What differs is the import, not
the behaviour, and each place that matters says so.

## Adding a tool without flooding the context

If you add an MCP server, this is the part that goes wrong quietly.

**A tool result is not a return value.** It joins the agent's session on the
`atoma-data` branch and is **resent on every later inference in that session,
across runs**. One large result is not a one-off cost — it is rent charged for the
rest of that issue's life. And when the session outgrows the model's context
window, the run fails with a provider error that has nothing to do with the tool
that caused it.

This is measured, in this repository. The largest single tool result in its stored
sessions was about **206k tokens** — more than a 200k context window, from one
call. One session reached ~672k tokens, of which the actual conversation was 9k;
the other 663k was tool output.

Five rules, in the order they pay off.

**1. Never return an API response whole. Project it.**

This is worth more than any cap, because a projection loses nothing. Measured on
this repository's own tools, before they were fixed:

| tool | raw | projected | |
| --- | --- | --- | --- |
| `get_branch` | 11,614 B | 81 B | **143×** |
| `get_check_runs` | 24,954 B | 1,363 B | **18×** |
| `get_pr_reviews` | 905 B | ~400 B | 2× |

`get_check_runs` asked GitHub for eight check runs and returned sixteen fields
each, of which the `app` object was **2,244 bytes per run** — the same GitHub App
description, eight times. What an agent can act on is four fields.

There is a pattern in those numbers: the tools built on `gh --json` were already
light, and the ones built on `gh api` were heavy. `--json` makes you name what you
want. Prefer whatever forces that choice.

**2. Cap every output, and say when the cap fired.**

Silence is the worst failure here. A truncated result that looks complete is how
an agent concludes something is absent when it was merely not shown — and then
acts on that. Put the marker **in the text**, not only in a sibling field: the
sibling field is what a caller forgets to read.

**3. Think about which end you keep.**

`shell_execute` kept the first million bytes of its output. A build log that
overran therefore returned its banner and dropped the compiler error — the only
part worth returning. A log is truncated from the front; a listing, a document or
a diff from the back; command output from the middle, keeping both ends.

**4. A count limit is not a volume limit.**

`get_issue_comments` bounds how *many* comments it returns and said nothing about
how big one may be, so a single comment with a log pasted into it filled the
window while the tool reported having shown three of forty. Cap each item *and*
the whole.

**5. Say the shape in the tool's description.**

The description is where a model reads a constraint — measured to work better
than the same sentence in the system prompt. A description promising "a JSON
branch object" while the tool returns three fields sends the model looking for
something that is not there. Say what you return, say that it can be truncated,
and say what to do about it.

Atoma's own tools share one budget, `TOOL_OUTPUT_BUDGET`: 50,000 characters, about
12.5k tokens, a tenth of the smallest context window worth designing for. It was
four numbers in three units before — 1,000,000 **bytes** in the shell, 60,000
characters in `web_fetch`, 50,000 in two GitHub tools, and nothing anywhere else.

That constant is this template's own, in `src/domain/tool-output.ts`. An adopted
repository has no copy of the file to read or edit; it receives the servers with
the cap already compiled into them. For a server of your own, the number is one to
copy, not one to look up.

**What is not covered.** `filesystem*` is a third-party server
(`@modelcontextprotocol/server-filesystem`), and a server's `hooks` can allow or
deny a tool but not touch its output — so `read_file` on a large file has no cap
this project can impose. That server's heaviest tool, `directory_tree`, is on its denylist for that
reason. `search_files` sat beside it and was let back in once atoma v0.1.21
capped every tool result: what kept it out was unbounded output, not what it does. For a large file, have the
agent read a range with `shell_execute` (`sed -n`, `head`) instead.

## How long your tool has to answer

Atoma cuts off one `tools/call` after 60 seconds. If your server can take longer,
say so in its entry under `tools.servers` — the section where a repository adds a
server of its own:

```yaml
tools:
  servers:
    my_tool:
      command: bun
      args: ["run", "./scripts/my_tool.ts"]
      request_timeout_secs: 600
```

A server this template ships is declared in `src/atomaton-runtime/tools/defaults.yaml`
instead — `.github/atomaton-runtime/tools/defaults.yaml` in an adopted repository —
and carries the same key there, in the same schema. Either way the value reaches
the core through the tools file a run writes for itself.

A server of your own that is started by a program rather than by `bun` also needs
that program installed: name it in `tools.packages`, beside the server. The shipped
servers' packages are in the deliverable, in
`.github/atomaton-runtime/tools/packages.json`, because they are not a project's
decision.

**A timeout argument in your tool's own schema does not raise this.** That is the
trap, and it is not hypothetical — it is how the shell server shipped. Its
`shell_execute` advertised `timeout_seconds` up to 3600 and defaulted to 300, so
the agent was told it could run a long build. Atoma cut the call off at 60, and
the error read `Timed out calling tool 'shell_execute' on MCP server 'shell'` — which
names your server, not the limit. Every value above 60 was a promise nothing kept.

Two shapes of work need this:

- **work that is genuinely long**: a build, a test suite, a migration.
- **a first call that pays for something the rest do not** — a model, an index, a
  connection. The search server loads a 544MB reranker on demand; it took 63.9
  seconds against the 60-second cap, so the first search of every run failed and
  the answer arrived fifteen seconds after nobody was waiting for it.

For the second shape, prefer moving the cost off the request before raising the
limit. Start the load when the server starts and do not await it — hold the
*promise*, not the resolved value, so the first call joins a load already in
progress instead of beginning one. Between the server connecting and the agent's
first search there were 47 seconds of the agent reading the issue, and that is
where a 63.9-second load mostly fits.

**Do not raise it just in case.** This limit is the only thing that notices a
server which has stopped responding. A server that answers in milliseconds should
keep the default, so a hung one is reported in a minute rather than in however long
seemed generous. `0` means the default, the same as leaving it out.

`ATOMA_MCP_TIMEOUT` changes the default for every server in a run, which is a
debugging lever rather than a configuration: a per-server value is the one that
travels with the tool.

The key's reference entry, with the rest of `tools.servers`, is in
[Configuration](configuration.md).

## If your tool does time out

The call fails and the agent sees an error. **Your server is not told** — it keeps
working and eventually writes an answer that nobody is waiting for.

Atoma discards that answer, matching the JSON-RPC `id` to the request in flight,
and logs a `warn` naming both ids. You do not have to do anything for this, but two
things follow for a server you write:

- **echo the `id`.** A server that returns a response without the id it answers,
  or with the wrong one, cannot be read correctly after any timeout.
- **do not assume the client is still there.** Work started before a timeout is
  work whose result is thrown away, so anything with a side effect should be
  idempotent — the agent will call you again.

## If your tool answers worse than it should

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

That import is this template's own source layout: `src/lib/mcp-report.ts`, reached
from `src/atomaton-runtime/tools/mcp/`. The servers an adopted repository receives are
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

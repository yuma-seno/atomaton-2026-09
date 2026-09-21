# Writing a tool

This page is for somebody writing an MCP server of their own — a file in your
repository, named under `tools.servers`, started by the same run as the servers
Atomaton ships.

Those shipped servers arrive under `.github/atomaton-runtime/tools/mcp/` as bundles,
with every helper named below already compiled into them. Nothing here is a module
you import: it is a set of rules your own server has to keep for itself.

## Adding a tool without flooding the context

If you add an MCP server, this is the part that goes wrong quietly.

**A tool result is not a return value.** It joins the agent's session on the
`atomaton-data` branch and is **resent on every later inference in that session,
across runs**. One large result is not a one-off cost — it is rent charged for the
rest of that issue's life. And when the session outgrows the model's context
window, the run fails with a provider error that has nothing to do with the tool
that caused it.

This is measured. Across the sessions recorded while Atomaton itself was built, the
largest single tool result was about **206k tokens** — more than a 200k context
window, from one call. One session reached ~672k tokens, of which the actual
conversation was 9k; the other 663k was tool output.

Five rules, in the order they pay off.

**1. Never return an API response whole. Project it.**

This is worth more than any cap, because a projection loses nothing. Measured on
Atomaton's own tools, before they were fixed:

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

Atomaton's own tools share one budget, `TOOL_OUTPUT_BUDGET`: 50,000 characters, about
12.5k tokens, a tenth of the smallest context window worth designing for. It was
four numbers in three units before — 1,000,000 **bytes** in the shell, 60,000
characters in `web_fetch`, 50,000 in two GitHub tools, and nothing anywhere else.

That number is compiled into the servers you receive. There is no file in your tree
holding it and nothing to override, so for a server of your own it is a number to
copy rather than one to look up.

**What is not covered.** A server's `hooks` can allow or deny a tool but not touch
its output, so a third-party server's cap is whatever that server decided. This
used to be the hole under `@modelcontextprotocol/server-filesystem`, whose
`read_file` had no cap this project could impose and no way to ask for part of a
file; the answer was to have the agent read a range with `shell_execute`. The
shipped `files` server replaced it, and its `read` takes `offset` and `limit` and
names the offset to continue from — so the workaround is gone along with the
server that needed it. The hole itself remains for anything else you add.

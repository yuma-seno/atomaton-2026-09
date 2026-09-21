# How long your tool has to answer

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

A server Atomaton ships declares it in `.github/atomaton-runtime/tools/defaults.yaml`
instead, under the same key and in the same schema. Raising one of those is an
override rather than an edit to that file — [let a tool run longer than a
minute](../tasks/let-a-tool-run-longer-than-a-minute.md). Either way the value
reaches the core through the tools file a run writes for itself.

A server of your own that is started by a program rather than by `bun` also needs
that program installed: name it in
[`tools.packages`](../reference.md#toolspackages), beside the server.

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
seemed generous.

`ATOMA_MCP_TIMEOUT` changes the default for every server in a run, which is a
debugging lever rather than a configuration: a per-server value is the one that
travels with the tool.

The key's reference entry, with the rest of `tools.servers`, is in
[the tools reference](../reference.md#request_timeout_secs).

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

# Let a tool run longer than a minute

Atoma cuts off one tool call after 60 seconds. Say so in that server's entry under
`tools.servers`:

```yaml
tools:
  servers:
    my_tool:
      command: bun
      args: ["run", "./scripts/my_tool.ts"]
      request_timeout_secs: 600
```

For a server Atomaton ships, write the same key under that server's name and nothing else.
An entry for a shipped name is an override merged field by field, so one line raises the
timeout and the argv, hooks and `env` stay as they ship:

```yaml
tools:
  servers:
    shell:
      request_timeout_secs: 7200
```

**A timeout argument in your tool's own schema does not raise this.** That is the trap,
and it is not hypothetical — it is how the shell server shipped. Its `shell_execute`
advertised `timeout_seconds` up to 3600 and defaulted to 300, so the agent was told it
could run a long build. Atoma cut the call off at 60, and the error named the server
rather than the limit.

**Do not raise it just in case.** This limit is the only thing that notices a server
which has stopped responding. A server that answers in milliseconds should keep the
default, so a hung one is reported in a minute rather than in however long seemed
generous. `0` means the default, the same as leaving it out.

If what is slow is a first call paying for a model, an index or a connection, move the
cost off the request before raising the limit. [docs/tools/how-it-works/how-long-a-tool-has.md](../how-it-works/how-long-a-tool-has.md)
has how, and what a server must do when a call is abandoned.

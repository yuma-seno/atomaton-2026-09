# What a record does not keep

**A session is not a transcript.** Each tool result is shortened to 4,000 characters
on the way in, so a session does not grow past what a model will accept; nine results
in ten are under that already. If a restored session is still too big, the contents
of older tool results are replaced with a note. **The calls themselves stay**, so an
agent can see what it already looked at and re-fetch only what it still needs, and a
tool call is never left without its result.

That is a second cap on the same text: what a command may print is already trimmed
before it reaches the agent —
[how much a shell command may print](../tools/boundaries.md#what-a-shell-command-may-print).

**The workspace is not durable storage.** It lives on the `atomaton-data` branch
alongside session state, is replaced wholesale each run — so a file an agent deletes
is gone — and is not somewhere to keep anything you would mind losing. If something
must persist for the project, it belongs in the repository or in
[`environment.setup_commands`](../environment/reference.md#environmentsetup_commands).

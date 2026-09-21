# Where a server, and its hooks, are read from

A shipped server's `args` carry `${ATOMATON_MACHINERY_ROOT:-.}` in front of their
paths, and it is not about secrets. On a pull request run the workspace **is** the
pull request, so a server read from `.github/atomaton-runtime/tools/mcp/...` would
be the pull request's own copy — letting it replace the code of the tools that
review it. The prefix points at a checkout of the default branch instead, and
falls back to `.` where no such checkout exists, such as a hand-run `atoma`.

The `files` servers take no such path: the directories they may reach are the
work tree and the shared workspace, decided by the server itself. The rule still
holds for anything a project adds — a path that means the workspace is the one
that should not carry the machinery root.

## A hook path is resolved against the tools file

`before_tool` is not prefixed either, and for a different reason. Atoma resolves
a relative hook path against the directory the **tools file** is in, not against
the working directory: `persistence/tool_def.rs` sets `base_dir = path.parent()`
and joins any non-absolute hook path onto it, then fails the run if the result
does not exist.

That directory used to be the one the hook scripts are in, so a path relative to
it landed on the right script by sitting still. It is not that any more —
[the tools file is written per run into a temp directory](the-tools-file.md) —
and a relative path would now follow the output rather than the script. So the
generator resolves every hook path as it writes, against
`.github/atomaton-runtime/tools/`, which is how the shipped entries name theirs:
`./hooks/shell_guard.ts`.

What you write therefore stays short, and what the core receives is absolute. An
absolute path is left as you wrote it, which is what a hook of your own kept
somewhere else needs — and a hook of your own belongs under `.github/atomaton/`,
so its relative path climbs out of the directory above.

This is written down because the argument for the `args` prefix is that a pull
request must not be able to replace the code that reviews it, and the hook is the
one piece of code that inspects what the agent is about to run. A reader checking
that the argument holds should not have to read the core to find out that it does.

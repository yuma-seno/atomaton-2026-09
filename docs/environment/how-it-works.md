# When the environment is missing something

An agent has no `sudo` and cannot write outside the repository. So when something it
needs is not installed, it has two ways out and they are different:

| what is missing | what the agent does |
| --- | --- |
| a library your project declares | edits the manifest and installs it — ordinary work, committed with the change |
| a system package, or a global CLI | adds it to [`environment.setup_commands`](reference.md#environmentsetup_commands), reports, and **stops**. That file needs your merge |
| the environment is broken, or needs what it just declared | calls `atomaton_env__reload_environment` |

The reload re-runs `environment.setup_commands` as a privileged step against the
current work tree, then starts a new run. **The commands come from the default
branch and the data from the work tree** — so a dependency the agent added to a
manifest gets installed by your own trusted command, and the agent cannot edit that
command. Letting it edit the setup would be arbitrary code execution as a user with
`sudo`.

It cannot conjure a system package your setup does not already ask for. Those
commands come from the default branch, so a line the agent just added to its branch
is not in them yet.

## At the cap

Each reload starts a new run with a fresh time budget, so there is a cap:
[`environment.max_reloads`](reference.md#environmentmax_reloads). At the cap the
tool refuses and tells the agent to report instead. The refusal is a tool error
rather than the end of the run, so the agent still has a turn in which to say what
it found.

**That report is what you see** when an agent names a missing dependency rather than
installing it: this piece of work has already rebuilt its environment as many times
as it may. Read what it reported. A system package or a global CLI belongs in
`environment.setup_commands`, which needs your merge either way; raise the cap only
if the rebuilds were making progress.

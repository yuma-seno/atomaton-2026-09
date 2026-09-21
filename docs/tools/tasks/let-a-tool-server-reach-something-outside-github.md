# Let a tool server reach something outside GitHub

A tool server that talks to something outside GitHub needs a credential — a Slack token,
an API key for your issue tracker. **Three steps, and each does a different job.** Doing
two of them and wondering why nothing arrives is the usual way to get this wrong.

**1. Add the secret to the repository**, the usual way, in Settings. Nothing in the
config creates a secret; the other two steps only refer to one.

**2. Authorise the run to hold it**, in `tools.secrets`:

```yaml
tools:
  secrets:
    - SLACK_TOKEN
```

This says the run may obtain that secret. It does not say which tool gets it — at this
point no tool can see it.

**3. Route it to the tool that needs it**, in that server's environment:

```yaml
tools:
  servers:
    slack:
      command: mcp-server-slack
      env:
        SLACK_TOKEN: "${SLACK_TOKEN}"
```

Now that one server receives it, under that name. **Every other tool still cannot see
it**, including the shell.

`slack` is a server of your own, so its entry declares it in full. Routing a credential
to one Atomaton ships — `github`, `search`, `web` and the rest — is the same step with a
shorter entry: the server's name and an `env` alone. An entry for a shipped name is
merged into it field by field, so naming `env` changes only the environment and leaves
the command, the hooks and the timeout as they ship.

A server of your own also has to exist on the runner. `mcp-server-slack` is a program,
and nothing installs it unless you say so: name its package in `tools.packages`, which
is where a project declares what a server it added needs. The shipped servers' own
packages are in the deliverable and are not repeated there. See
[docs/configuration.md](../../configuration.md), under `tools.packages`.

Steps 2 and 3 are two keys in the same file, which does not make them one step:
authorising a credential does not deliver it. `checks` and `deploy` need no third step at
all, because their commands run in a workflow of their own rather than beside an agent —
a secret named on a deployment's entry is in that job's environment and there is no
server to route it to.

You never edit a workflow for any of this, and there is no tools file to edit: the one
`atoma` is handed is written at the start of each run — from the servers Atomaton ships and
whatever `tools.servers` adds or overrides — and thrown away with the runner.
`config.yaml` is still the only place a credential is routed.

Why routing is required at all is in [docs/configuration.md](../../configuration.md); what it
does and does not protect you from is in [docs/operations.md](../../operations.md).

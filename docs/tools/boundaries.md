# What routing a credential protects

`tools.secrets` is separate from the credentials a check or a deployment names on
its own entry, because that separation **is** the boundary: only these enter an
agent's own environment, so a prompt injection carried in an issue body reaches
them and no deployment credential. Collapsing them into one list would put every
credential in every destination while still looking like a boundary, which is
worse than having no boundary at all.

The declaration is in the config rather than in a repository variable because it
is the most security-relevant setting this project has. In the config it is
versioned, it shows up in a diff, and it passes
[the governance gate](../pull-requests/boundaries.md) that already covers
`.github/**`. In repository settings it would be invisible to everyone reviewing
the repository — precisely the audience for "what credentials can this reach".

What the routing then does **not** protect you from — which credentials a tool
server can reach in practice, and which are deliberately left exposed to the
shell — is in
[docs/operations.md](../operations.md#what-a-tool-can-and-cannot-be-protected-from).
Read it before routing a credential to a third-party server.

If a particular credential cannot be exposed that way, the option that avoids
routing altogether is to let the tool that needs it be a step in
[`checks.from_pull_request`](../pipeline/boundaries.md#a-check-that-needs-a-credential),
which runs in its own job.

## Why the agent's own run is Linux

`runs_on` sets the machine for the jobs that run **your** commands. It does not
reach the agent's own run, which stays on Linux, because what isolates a tool
server from the others is Linux-only top to bottom: `useradd` for the user with
no sudo, `setfacl` for the ACLs, `prctl(PR_SET_DUMPABLE)`, `/proc/<pid>/environ`
being the thing closed. Making that configurable would mean an agent's shell
running with every one of those protections silently absent.

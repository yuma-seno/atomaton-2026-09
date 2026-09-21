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
shell — is
[what a tool can and cannot be protected from](#what-a-tool-can-and-cannot-be-protected-from),
below. Read it before routing a credential to a third-party server.

## What a tool can and cannot be protected from

Every tool server runs as **one dedicated OS user with no sudo**. One user, so no
tool sees a different filesystem, a different `$HOME` or a different toolchain from
another. No sudo, because with it nothing else means anything: `sudo cat
/proc/<pid>/environ` reads any process whatever else is arranged.

That is a deliberate trade, and knowing which way it went is more useful than a
claim of full isolation.

**Three things cannot all be true.**

1. every tool sees the same environment
2. a credential in one tool is hidden from the shell tool
3. any third-party MCP server works

(3) means a server takes its credential the way it was written to, which is an
environment variable. (1) means the shell shares the filesystem and the user with
it. Given both, (2) fails — and not through one hole that can be closed.
`/proc/<pid>/environ` is readable between processes of one user; a file called
`gh` in a world-writable directory on PATH is executed by the server looking for
`gh`; a config file under `$HOME` tells another tool what to run. Each of those
has an answer below — and the point is that the *list* of channels is not
enumerable, so closing the three that are known is not the same as a guarantee.

**What was chosen:** (1) and (2) for the tools this project ships. (3) as a
documented limit rather than a guarantee.

### Protected

**The provider API key.** It is never in a tool server at all. Atoma holds it, and
makes itself unreadable to processes of the same user, so no tool can reach it.

**Credentials in the servers this project ships** — `github`, `web`, `search`,
`atoma`. Each makes itself unreadable at startup and removes world-writable
directories from its own PATH, so neither reading its environment nor planting a
binary it would run works.

### Not protected, deliberately

**`GH_TOKEN`, from the shell tool.** It expires when the job ends, the agent can
already use it through the `github__*` tools, and `actions/checkout` leaves the
same value in `.git/config` inside the work tree — so a boundary around the
server's environment would not have covered it anyway.

**A credential you route to a THIRD-PARTY server** through `tools.secrets`. That
server cannot be made to protect itself — the mechanism has to be called by the
process it protects, and nothing can call it on another program's behalf. Assume a
credential you give a third-party server is readable by the shell tool.

If that matters for a particular credential, the options are to give it only to a
server shipped here, or not to route it at all and let the tool that needs it be a
step in [`checks.from_pull_request`](../pipeline/boundaries.md#a-check-that-needs-a-credential),
which runs in its own job.

**The shell guard is not a boundary either.** It is a text match over a command
line that redirects the agent to the MCP tool which does the job properly, not a
sandbox, and nothing about it is load-bearing. The two controls that are: per-tool
credential confinement, below, and
[the governed-paths merge gate](../pull-requests/boundaries.md).

### What the filesystem does

Writes outside the repository **fail** rather than appearing to work. `$HOME` is
read-only, the same for every tool, and package-manager caches are redirected to a
writable directory by the runner. An error an agent can read beats a success it
cannot trust.

### Which credentials a tool server can reach

A credential reaches the Atoma process and the servers that name it. Nothing else
— not the shell, not another tool server's declared credentials by ordinary
means, not a later workflow step.

Two limits are worth stating plainly rather than discovering.

**Tool servers are not isolated from each other.** They run as the same user, so
a deliberate attempt from one can reach another's environment. Treat a credential
declared for one tool as reachable by all of them if something is actively trying.

**None of this stops intent, only accident.** An agent reads issue text written by
anyone who can open an issue, and a prompt injection can ask it to do whatever a
tool allows. What remains is the two controls that always mattered: declare only
the credentials a tool genuinely needs, and read the diff when a governed file
changes.

Which of your secrets a run is handed is settled before any of this, by
[the ref a declaration is read from](../pipeline/how-it-works.md). Four things
fail the run rather than being quietly dropped, and a fifth is only a warning;
[`tools.secrets`](reference.md#toolssecrets) lists them.

### What a shell command may print

A shell command's output is redacted before the agent, the run log, the session,
or an issue comment ever sees it. Two things are removed: text shaped like a
vendor credential (`sk-`, `ghp_`, `AKIA`, a PEM header, and similar), and the
exact values of the API key and tokens the run itself holds.

This is a net, not a control. A value *derived* from a secret — a slice of a key,
a base64 of one — is indistinguishable from ordinary text and gets through. Keep
secrets your agents do not need out of their environment, and treat this as the
thing that catches the accident rather than the thing that makes it safe.

It exists because two of the three places a run's output lands are otherwise
unprotected: GitHub Actions substitutes `***` for registered secrets in the
workflow log, and does nothing for the issue comment a run posts or for the
session JSON on the `atomaton-data` branch.

**How much it may print** is a separate limit, and it is not configurable. A long
stdout or stderr keeps its beginning and its **end**, with a marker naming how
much went from the middle and `output_truncated` set on the result. Both ends,
because command output is both kinds of text at once: a header or a command echo
worth seeing, and a failure at the bottom.

That end used to be the part that was dropped — the cap was a million bytes and it
kept the head, so a build log that overran returned its banner rather than its
error. A million bytes is also about 250k tokens, more than a context window, from
one call. See [writing a tool](tasks/write-a-tool.md) for why that matters beyond
the one run, and [what a record does not keep](../records/boundaries.md) for the
second cap the same text meets on its way into a session.

## Why the agent's own run is Linux

`runs_on` sets the machine for the jobs that run **your** commands. It does not
reach the agent's own run, which stays on Linux, because what isolates a tool
server from the others is Linux-only top to bottom: `useradd` for the user with
no sudo, `setfacl` for the ACLs, `prctl(PR_SET_DUMPABLE)`, `/proc/<pid>/environ`
being the thing closed. Making that configurable would mean an agent's shell
running with every one of those protections silently absent.

# How a credential reaches a tool

A tool server receives only what its own `env:` names. Anything Atoma recognises
as a credential is removed from a server's environment before that block is
applied, so `env: {}` means "this server gets no credentials" — which is the
default, and is the point rather than an oversight.

The shell tool is the one to think about. It can run anything, so a credential it
can read is a credential the agent can read and send anywhere. It ships with
`env: {}`, and putting a credential there takes an override you wrote on purpose
— which is what makes "the tool holds the secret, the agent does not" true rather
than aspirational.

That is also why four of the shipped servers declare the run's GitHub token
rather than inheriting it. `github`, `search`, `atomaton` and `atomaton_env` shell
out to `gh`; the declaration on each is what keeps the same token out of `shell`.

## Which layer decides what

| Layer | Decides |
| --- | --- |
| Repository secrets | the value |
| `tools.secrets` | whether the run may hold it |
| `tools.servers.<name>.env: ${NAME}` | which tool receives it |

The bottom two are keys in one file and are still two decisions: the list says
what the run may hold, a server's `env` says which server sees it, and the second
is what keeps the first out of the shell. **Authorising a credential does not
deliver it.** The three steps, end to end, are
[let a tool server reach something outside GitHub](../tasks/let-a-tool-server-reach-something-outside-github.md).

`checks` and `deploy` need no third step at all, because their commands run in a
workflow of their own rather than beside an agent — a secret named on a
deployment's entry is in that job's environment and there is no server to route
it to.

The bottom row reads the same whether the server is one of yours or one Atomaton
ships. For a shipped name, an entry carrying `env` and nothing else is an
override of that one field, so the credential arrives without your having to copy
the server's command or hooks.

**Never write a value, only a `${NAME}` reference.** `${SLACK_TOKEN}` is resolved
at run time; a pasted secret is committed in plain text.

## Why the rejections are loud

A credential that was asked for and silently not delivered surfaces much later as
a tool failure pointing nowhere near the cause. So the malformed name, the
reserved name, the duplicate and the eleventh entry each fail the run instead —
[what `tools.secrets` refuses](../reference.md#toolssecrets).

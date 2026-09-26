# What an agent can reach

Every run starts with a set of tool servers, and `tools` in `config.yaml` is
**additive**: the set is Atomaton's own, and what you write there is added to it.

The shipped servers are not in your config. They ship as data, in
`.github/atomaton-runtime/tools/defaults.yaml`, in the same schema as
`tools.servers`, and that file is there to be **read** — overriding a shipped
server means being able to see the entry you are overriding: its `command`, its
`args`, what its `env` actually routes. It is not yours to edit, because it is
under the runtime root and an upgrade replaces it. `.github/atomaton/README.md`
says why they sit there rather than in the file you own.

An agent receives the servers its own `mcp_servers` names and no others, so a
server nobody names is never started and costs nothing. That is why there is no
way to remove one: there is nothing to gain by it, and
[naming one that does not exist stops the run](when-it-breaks.md#a-name-that-is-not-a-server)
before a single tool starts.

## Why these rather than off-the-shelf servers

`files` replaces `@modelcontextprotocol/server-filesystem`, which has no line
range and no content search. Measured over two runs of these agents, 202 tool
calls: 37 of the 63 shell calls were `sed -n A,Bp` and `grep -rn`, rebuilding
both by hand. The reviewer, which has no shell, could not — it read one
1,700-line file four times with `head` and `tail`, which never reach the middle,
and 43% of everything it read came back truncated.

That is also the reason `read` reports the offset to continue from: the four
reads happened because nothing said that the number being changed did not decide
how much came back.

## One server, two entries

Two of the shipped servers are the same program as another one with tools
withheld: `files_readonly` is `files` without the three that write, and
`atomaton_env` is `atomaton` with everything but `reload_environment` withheld.

The second case is why the pattern exists. `reload_environment` is for whoever is
doing the work — the engineer, which is the agent that finds a dependency
missing. The other tools on that server are the atomaton's:
`request_close_issue` calls itself "the ONLY correct way for the atomaton to
finish an issue", and an engineer that could call it could end an issue without a
review. So the server cannot simply be handed over.

An allowlist is how this project solves that, rather than a second
implementation. The cost is a second process of the same script and a longer tool
name the agent reads. Both are visible, which is the point — the alternative is
one server whose tools mean different things depending on who called them.

The same shape is available to you: an entry under `tools.servers` naming a
shipped server and a narrower `hooks` block
[replaces that server's](reference.md#toolsservers), which is the direction an
allowlist has to compose in.

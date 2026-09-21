# `tools`

What an agent can reach, and under what watch. This section is
[additive](overview.md): everything below is added to the servers every run
already starts with.

## The servers every run starts with

| Server | What it is for | Credential |
| --- | --- | --- |
| `files` | Reads, searches and changes files in the work tree. Its tools are named `read`, `grep`, `glob`, `edit`, `write`, `list`, with no server prefix. | none |
| `files_readonly` | The same server with the three that write left out, for agents that must not change anything. | none |
| `shell` | Runs one foreground command. Guarded, and holds no credentials of its own. | none |
| `github` | Issues, pull requests, comments, and every Git mutation. | the run's GitHub token |
| `web` | Fetches a URL, and returns what it fetched. Searching the web is a skill rather than a tool — see [change or remove web fetching and search](tasks/change-or-remove-web-fetching-and-search.md). | none |
| `search` | Ranked search over this repository's issues and code. | the run's GitHub token |
| `atomaton` | Atomaton's own operations: sub-issues, handoffs, stopping a run. | the run's GitHub token |
| `atomaton_env` | Rebuilding the run's environment, and nothing else. | the run's GitHub token |

Why four of them declare a credential rather than inheriting one, and why the
other four cannot see it, is
[how a credential reaches a tool](how-it-works/routing-a-credential.md).

`files_readonly` and `atomaton_env` are not separate implementations. Each is a
second entry for a server above with tools withheld — an allowlist, and
[a pattern with a reason](overview.md#one-server-two-entries).

What each server's tools do in a run is in
[docs/operations.md](../operations.md#what-the-agents-own-tools-do).

`files` gives `read` an `offset` and a `limit` in lines, and a result that
stopped early names the offset to continue from. `read` also returns a picture as
a picture, so an agent whose definition sets
[`vision: true`](../agents/reference.md#vision) can look at a screenshot in the
repository; one without it gets a note saying the picture was withheld. `grep`
searches contents and takes `glob` to narrow which files and `context` for the
lines around a match; `glob` matches paths and never reads a file, so it does not
replace a grep — it answers where something is by name. There is no
`directory_tree`: it returns the whole tree, always, and there is no question
whose answer is the whole tree. `list` answers the ones there are.

`shell` is the one server that runs arbitrary commands, and therefore the one
that runs third-party code: a dependency's postinstall, a `setup.py`, a
`build.rs`. Those run with this server's privileges. `$HOME` is the runner's,
readable and **not** writable, the same for every tool — a write there fails
rather than appearing to work, because caches are redirected to a writable
directory by the environment the runner sets. Its `request_timeout_secs` is 3600,
which is a backstop for the server itself dying rather than a limit on the work:
the server enforces its own per-call limit and always answers.

## `tools.secrets`

Repository secrets the servers may reach, by name.

```yaml
tools:
  secrets:
    - SLACK_TOKEN
```

Naming a secret authorises the run to hold it. It does not deliver it to any
tool; the `env` on a server's own entry is the step that does, and
[the two are not one step](how-it-works/routing-a-credential.md).

**Four things fail the run** rather than being quietly dropped:

- a name that is not shaped like an environment variable (`SLACK_TOKEN`, not
  `slack_token` or `Slack-Token`)
- a name the run already uses for itself, such as `GH_TOKEN` or
  `OPENAI_API_KEY` — declaring one would replace the run's own value rather than
  add a credential
- the same name twice
- more than ten names, which is the number of slots the generated workflow
  carries; raising it needs a new release

A provider's `*_BASE_URL` may not be declared here either, for
[a different reason](../agents/boundaries.md).

Naming a secret the repository does not actually have is a warning rather than a
failure. The run itself is unaffected, and only the tool needing that value will
fail — with the reason already in the log.

Why this list is separate from a check's or a deployment's `secrets`, and why it
is in the config rather than in a repository variable, is
[what routing protects](boundaries.md).

## `tools.servers`

Servers of your own, and overrides of the ones Atomaton ships. It starts empty,
and what you write is **added to** the shipped set rather than standing in for
it.

One entry per server: `command`, `args`, `env`, `hooks`, `request_timeout_secs`,
and `settings` — the last being this project's own, stripped by the generator so
it never reaches the core. Everything else is the core's own tools-file format,
one level in, and is passed through untouched, so a key a later core release adds
works the day it ships.

**A name Atomaton does not ship is added.** It needs a whole entry, starting with
a `command`, because nothing else knows how to start it. A server of your own
also has to exist on the runner — see [`tools.packages`](#toolspackages).

**A name Atomaton does ship is an override, merged field by field.** Write only
what you are changing:

```yaml
tools:
  servers:
    shell:
      request_timeout_secs: 7200
```

That raises one timeout and inherits the argv, the hooks and the empty `env`, so
an upgrade that changes any of those still moves them. Pasting the whole shipped
entry to alter one field is what freezes the rest at today's values.

The merge is one level deep, so a `hooks` block you write **replaces** that
server's rather than adding to it. That is the right direction for the thing it
is: narrowing `files_readonly`'s `tool_allowlist` has to mean the list you wrote,
where a union could only ever widen it.

**There is no way to remove one, and none is needed.** A project finished with
`web` drops it from the agent definitions that name it — which is where the
decision belongs, because it is a decision per agent rather than per repository.

A server may not be called `hooks`: that name is the core's own reserved key at
the top level of a tools file, which is where `tools.watch` is written, and a
server called `hooks` would silently become one. The check on every pull request
refuses it, and so does the run that writes the file.

Where a server's `args` and `hooks` paths are resolved against is
[not the directory you would guess](how-it-works/where-a-server-is-read-from.md).

### `request_timeout_secs`

Atoma cuts off one `tools/call` after 60 seconds. If a server can take longer,
say so in its entry. `0` means the default, the same as leaving it out.

Everything else about this number — the trap of a timeout in your own tool's
schema, why not to raise it just in case, and what a server must do when a call
is abandoned — is in
[how long your tool has to answer](how-it-works/how-long-a-tool-has.md).

### `reranker_model`

The cross encoder the issue search ranks with.

```yaml
tools:
  servers:
    search:
      settings:
        reranker_model: onnx-community/bge-reranker-v2-m3-ONNX
```

It sits under the server because the server itself reads it, not the core:
`settings` is the one key this project reserves inside a server entry, and the
generator strips it out of the tools file the core is handed, which would
otherwise refuse a key it does not know. `search` is a shipped server, so that
block is an override of one field: it names `settings` and nothing else, and the
command, the credential and the timeout stay as shipped.

The default is multilingual and about 600MB, downloaded once per runner and
cached after that. Name a smaller cross encoder here if that cost matters more
than ranking quality, or a language-specific one if your issues are all in one
language. Any model the runner can load as a sequence-classification cross
encoder works; the search still functions if it fails to load, falling back to
the first stage's own order — [which is the stage this setting does not
touch](how-it-works/how-the-issue-search-ranks.md).

## `tools.packages`

What a server of **yours** needs installed on the runner before anything starts.
A server you added under `tools.servers` is started by something, and unless that
something is `bun` running a file in your repository, the runner has to be given
it:

```yaml
tools:
  packages:
    npm: ["@acme/mcp-server-jira"]
    bun: ["pdf-parse"]
    pip: ["mcp-server-time"]
```

Three lists, because three things are being asked for. `tools.packages.npm` is
for an **executable**: each name is installed globally and the global bin
directory is put on `PATH`, which is what a `command:` naming a program rather
than a path needs. `tools.packages.bun` is for a **library a server imports**
rather than spawns — one that cannot be bundled because it reaches native code.
Those are installed beside the machinery checkout rather than in your work tree,
so a different version installed by your `environment.setup_commands` cannot
break a tool server. `tools.packages.pip` is for a server that ships as a Python
package.

**The shipped servers' own packages are not here.** They are in the deliverable,
at `.github/atomaton-runtime/tools/packages.json`, because they are not a
project's decision: `@huggingface/transformers` is what `search` reranks with.
That server cannot be removed, so the package cannot be, and a list you edit that
contains entries you must not delete is an invitation to delete one — which would
show up as a tool server that will not start, a long way from the line that
caused it.

Both halves are installed as one deduplicated set, the deliverable's first, and
**both are hashed into the cache key** for the package download cache. Hashing
one would let you add a package here, hit a cache keyed on the file you did not
touch, and get a runner without it, with nothing saying why.

This key is for tool servers only. What your project's own code, tests and
deployment need goes in
[`environment.setup_commands`](../environment/reference.md#environmentsetup_commands).

## `tools.watch`

Hooks that apply to **every** server, run before each server's own, beside
`tools.servers` rather than inside any one of them. It is additive in the same
way the servers are: Atomaton ships its own file-wide hooks, and yours are
**appended** to them rather than replacing them.

```yaml
tools:
  watch:
    before_tool: ../../atoma/hooks/my_check.ts
```

A hook level takes one path or a list of them, and the generator writes the
combined list — Atomaton's first, then yours — into the tools file under `hooks`,
the name the core reserves there. Order is the contract for `before_tool`, where
the first refusal wins, which is why the machinery's run first.

It is called `watch` in the config so that it does not sit beside the per-server
`hooks` meaning something narrower.

**The file-wide form is usually the right shape**, because what is worth watching
is usually the run rather than a tool: how much has been written where, how long
a search has gone on. Attached to one server, such a check only watches the agent
while it happens to be using that server, and says nothing for the twenty calls
it spends elsewhere. The one Atomaton ships, `workspace_guard.ts`, answers with a
notice when the shared workspace has grown past what will be carried into the
next run; it is an `after_tool` rather than a `before_tool` because it reports
rather than refuses.

A hook of your own is a file of your own, so it belongs under
`.github/atomaton/` — which is why the path above climbs out of the directory
hook paths are
[resolved against](how-it-works/where-a-server-is-read-from.md).

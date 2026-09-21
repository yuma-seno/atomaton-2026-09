# What the merge gate stops

What GitHub enforces is separate, and lives in
`.github/atomaton/rulesets/main.json`, in GitHub's own import format. On a
repository where branch rules are unavailable — they are a paid feature on a
private one — GitHub refuses nothing and `merge` is the whole of the gate. The
same absence makes
[a deployment refuse to start](../pipeline/boundaries.md#a-deployment-refuses-a-branch-anyone-can-push-to),
which is the other half of the same missing protection.

This gate is one of the two controls that actually hold: it and
[per-tool credential confinement](../tools/boundaries.md#which-credentials-a-tool-server-can-reach).
The shell guard is not one of them, and
[says so itself](../tools/boundaries.md#what-a-tool-can-and-cannot-be-protected-from).

## Why the whole directory

`.github/**` is where an agent's limits live — which credentials reach a run, the
scripts the runner executes to decide when a run may continue, which commands the
shell hook refuses, what a ruleset requires before a merge. An agent that could
merge a change to them could widen its own reach, and nothing later catches it,
because the next run already obeys the new file.

This is not about an agent intending to. A prompt injection carried in an issue
body reaches exactly as far, and so does an ordinary mistake. Both stop at a
person reading the diff.

The whole directory, rather than the parts of it that obviously matter. An
earlier default named four subdirectories and left out the scripts directory —
today `.github/atomaton-runtime/scripts/**` — which is where the runner's own
control logic lives; nothing decided that, the list was simply written before the
directory existed. A list of the paths that count has to be revisited every time
the tree grows, and gives no sign when it has not been. That move is the proof:
the runtime changed directory, and a default naming subdirectories would have
quietly stopped governing it.

## What it does not cover

The provider API key and `GITHUB_TOKEN` are in the agent's own environment
because the run needs them to work at all, and no setting moves them out.

Every other repository secret stays outside that environment until you name it.
Nothing reaches an agent by being a secret; it reaches an agent by being
declared, in [`tools.secrets`](../tools/reference.md#toolssecrets) — and that
declaration is in a file this gate already covers.

## Why not a required status check

A required check stops everyone, including you. These stop only the agent, which
is the actual request: not "this must not be merged" but "this is not an agent's
call".

## Why configuration and not a script

A script could read a migration and notice it drops a production table, which no
amount of configuration can. It also needs a timeout, a decision about what a
crash means, and protection against a pull request supplying the very program
that judges it. `config.yaml` is
[read from the default branch](../pipeline/how-it-works.md) already, so a pull
request cannot weaken the gate that is judging it. If you hit a real case that
conditions cannot express, that is worth an issue — the shape here leaves room
for it.

## What a pull request is checked against

Every pull request an agent opens is checked for one thing before your CI is asked
to run at all: whether the `.github/atomaton/` it would merge can still start a run.

This is not your pipeline and it is not configurable. It runs whether or not
`checks.from_pull_request` is set, and it reads nothing from `checks` or `deploy`
to decide what to check — those describe what YOU verify. This one answers a
narrower question that only has one right answer. It is not the merge gate either:
what an agent may merge once this is green is [`merge`](reference.md).

What it checks:

- Every `mcp_servers` name in every agent definition exists in the tools file the
  run would write — the servers Atomaton ships, plus whatever `tools.servers` adds —
  along with `knows_about` targets and `extra_body` keys. This part runs
  `atoma validate`, so it is the same resolution a run performs rather than an
  imitation of it.
- `config.yaml` uses only keys Atomaton reads.
- `checks` and `deploy` each declare one arm, rather than both —
  [have agents start your own CI and deployment](../pipeline/tasks/have-agents-start-your-own-ci-and-deployment.md)
  is where that choice is made.
- `merge.gates`, every `deploy` list and every `secrets` list parse.
  These were already validated, but at merge time, at deploy time, and when
  a credential was handed out. Nothing new is being judged; it is being judged
  earlier.
- Names resolve to files: the workflow `checks.your_workflow` or
  `deploy.your_workflow` names.

What it does not check is anything that needs a run to find out. Whether your
commands pass, whether a deployment works, whether a model answers — that is CI's
job, and this deliberately does not duplicate it.

**And it starts nothing.** `tools.servers` lets any pull request name any
`command`, so a check that started the servers a pull request declares would
execute that pull request inside the job that decides whether it may merge. This
one reads the pull request's `.github/atomaton/` as data and runs nothing under
`--root`. The half that needs live servers — whether an allowlist pattern still
names a tool that exists, whether two `unprefixed` servers claim one name, whether
a server starts at all — belongs on the other end of the pipeline, in a release,
and [nothing there runs it for you](../pipeline/boundaries.md#nothing-checks-that-your-tool-servers-still-start).

**Why this exists.**
[A name that is not a server](../tools/when-it-breaks.md#a-name-that-is-not-a-server)
stops a run before a single tool server starts, and until this check existed that
failure landed on whoever triggered the *next* run. It had already happened here:
an agent looked at its own tool surface, concluded a server was unused, removed it,
and broke a different agent that depended on it. A shipped server can no longer be
removed that way, but a name can still be mistyped, and a server a project added
itself can still be deleted or renamed while an agent still names it.

You can run the same check against a checkout or a worktree before you push —
[check your config before pushing it](../config/tasks/check-your-config-before-pushing-it.md).
What you see when it fails on the pull request instead is
[what an agent's pull request meets](how-it-works.md#when-the-check-on-the-deliverable-fails).

## The release pull request is yours

Atomaton has no notion of a release. The promotion pull request — `develop` into
`main`, or whatever your equivalent is — is yours to open, and nothing about it is
special here: it is reviewed by whoever reviews releases, and merging it runs
whatever your default branch already runs. Deciding that a set of work is ready to
ship is a judgement no agent is positioned to make.

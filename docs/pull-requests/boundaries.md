# What the merge gate stops

What GitHub enforces is separate, and lives in
`.github/atomaton/rulesets/main.json`, in GitHub's own import format. On a
repository where branch rules are unavailable — they are a paid feature on a
private one — GitHub refuses nothing and `merge` is the whole of the gate. The
same absence makes
[a deployment refuse to start](../pipeline/boundaries.md#a-deployment-refuses-a-branch-anyone-can-push-to),
which is the other half of the same missing protection.

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

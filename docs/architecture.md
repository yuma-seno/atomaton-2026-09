# Architecture

*What the layers are, what each one may name, and where a module belongs.*

## Why this document exists

The rules below were settled in discussion and, until this file, existed only in
a chat log and in the comment at the top of one module. `docs/edd.md` names that
as a way the loop opens:

> Reasons are not kept. The same question is settled twice, or a decision is
> reversed by someone who never saw why it was made.

An agent working in this repository reads this file to know where its change
belongs. Whoever disagrees with a rule changes it here first.

## The dependency rule

Arrows point inward. Nothing in an inner layer may import from an outer one.

| Layer | May import | What it is |
| --- | --- | --- |
| `src/domain/**` | `shared/` | The rules. Pure: no I/O, no `process`, no clock, no randomness. |
| `src/shared/**` | nothing | Leaf algorithms that know nothing about this product. |
| `src/app/**` | `domain/`, `shared/`, `adapters/` | Use cases: one scenario, orchestrating adapters. |
| `src/adapters/**` | `domain/`, `shared/` | Everything that touches the outside. |
| `src/entrypoints/**` | everything | Thin CLIs and servers: arguments and exit codes. |
| `src/content/**` | — | Not code. What ships to an adopter. |

Inside `adapters/`, one folder per thing spoken to: `github/` (the `gh` CLI,
GraphQL, tags in comment bodies, labels), `actions/` (dispatching a workflow),
`runner/` (the process we are inside — `config.yaml` on disk, the machinery root
in the environment, the ops log in temp), `mcp/` (defining a tool, reporting on
one), `atoma/` (the session file).

`types/` at the repository root holds ambient `.d.ts` declarations. It is not a
layer, which is why it is not under `src/`.

`tests/contract/layering.test.ts` reads every import and fails on an arrow that
points the wrong way. It is a ratchet, not a design: it sees imports, not
meaning, and none of the defects this refactor was opened for are visible to it.

## What the domain may say about GitHub

This product is not portable and is not trying to be. It runs on Actions, it
stores its work in issues, and a person's view of it is the issue thread. The
domain is therefore allowed to speak GitHub. What it may not do is depend on
GitHub.

Three categories, and the test that separates them:

> **Is this a noun a person doing the work would recognise, or one only someone
> implementing on GitHub would know?**

| | Where it lives | Examples |
| --- | --- | --- |
| **Borrowed vocabulary** — concepts GitHub *chose*, which we adopt on purpose | `domain/`, keeping GitHub's own names | issue, pull request, review, merge, the tree, the thread |
| **Mechanism** — how GitHub happens to implement something | `adapters/` | label, check run, `workflow_dispatch`, GraphQL fields, orphan branches, the 60-minute cap |
| **Defect** — where GitHub does not do what it appears to | one table, in `adapters/github/` | `closingIssuesReferences` dropped, search tokenisation, no workflow run for our own token's events |

Renaming `Issue` to `WorkItem` is not on the list. It is a generalisation nobody
asked for, and it would move the code away from the product rather than towards
the model.

### The rule that was actually broken

A domain concept may carry a GitHub name. It may not be **defined** by a
mechanism.

```ts
/** A run holds this node now — the in-progress label is on it. */
running: boolean;
```

`running` is a sound domain concept. Its definition is a label, which is
mechanism. The field stays; the definition changes. Reviewing for this means
reading doc comments, not import lists.

## The four domains

Measured before splitting: `src/domain/` had 26 internal import edges. Exactly
one of them ran between two modules of the work domain (`progress` to
`dispatch-chain`), while the delivery modules formed a dense cluster of twelve.

That asymmetry is not tidiness. The work modules do not import each other
because they share no types — each is a standalone predicate over primitives.
A domain with a model in it would have them meeting somewhere. See the open
question on `Turn`.

| Directory | What it holds |
| --- | --- |
| `domain/work/` | The tree, a turn on a node, who goes next, what stop and close reach. |
| `domain/delivery/` | What the adopting project declares it checks and deploys. |
| `domain/machinery/` | What Atomaton ships, where it lands, and which tree is trusted. |
| `domain/record/` | What the environment keeps about its own operation — `docs/edd.md`'s centre. |

A module goes where its **vocabulary** is, not where its caller is. A pure rule
written entirely in the store's path shapes belongs to the store, even though it
is pure.

They are not four peers. Measured after the split, three edges cross a context
boundary, and they all run the same way:

```text
delivery  ->  work, machinery
record    ->  work
work      ->  (nothing)
machinery ->  (nothing)
```

- `delivery/deliverable-integrity.ts` reads `work/control-commands.ts`, so that
  an agent definition cannot be named `/stop`. One list, two rules.
- `delivery/declared-secrets.ts` reads `machinery/machinery-layout.ts`, because
  which secrets a job may reach depends on which tree it runs from.
- `record/tool-tally.ts` reads `work/session.ts`, because what it counts is what
  a turn left behind.

So the rule inside `domain/` is the same as the rule outside it: arrows point
inward, and `work` and `machinery` are the inside. An edge the other way is the
signal that a module is in the wrong context — not something to add to the list
above.

## Where the deployed tree splits, and why

Two roots, and the line between them is **declaration versus mechanism** —
stated first in `deploy-jobs.ts`: *an agent can write configuration and cannot
write a workflow.*

| Path | Who changes it | Holds |
| --- | --- | --- |
| `.github/atomaton/` | the adopting team, agents included | `config.yaml`, prompt template, agent definitions, skills, rulesets, **and `scripts/`** |
| `.github/atomaton-runtime/` | upstream, through a pull request | the machinery: `scripts/`, `tools/` |

The deployed layout is a published interface — an adopter's tree is replaced by
position, so a path there is not one to move on a whim — and the source layout
is ours, sorted by layer. They agree on nothing: `content/` deploys to
`.github/atomaton/`, `entrypoints/machinery/` to
`.github/atomaton-runtime/scripts/`, `entrypoints/tools/` to
`.github/atomaton-runtime/tools/`. `BUILT_FROM` in `machinery-layout.ts` is the
whole correspondence, and `build-dist.ts` reads it rather than deriving one name
from the other.

`.github/atomaton/scripts/` is where a project puts the commands its
`config.yaml` names. It is not shipped — an adopter creates it — and this
repository keeps its own there, through `self/`, so that
`./.github/atomaton/scripts/tag-release.sh` is a path that means the same thing
here and in an adopted repository. A path under `self/` would be an example
nobody could copy.

Scripts there run with whatever credentials the job declares. That is not a new
opening: `config.yaml`'s `commands` have always been agent-writable, which is
exactly why `checks.from_pull_request` is given no secret. Review is the gate,
here as everywhere.

`self/` is this repository's own overlay onto `.github/`, copied verbatim by
`self/workflows/atomaton-self-deploy.yml`. It mirrors `.github/` exactly, so
nothing goes in it that does not belong in `.github/` — and an overlay file is a
copy rather than a build, so both halves change in the same pull request.
`self-overlay.test.ts` holds them to each other in both directions.

This repository's own release scripts live at `self/atomaton/scripts/`, which is
`.github/atomaton/scripts/` once deployed. Nothing ships there: the directory is
the adopter's to create, and this repository keeping its own in it is what makes
the path in `config.yaml` a line an adopter can copy rather than translate.

`probes/` is neither. A probe measures something no unit test can reach — whether
`PR_SET_DUMPABLE(0)` survives `execve`, whether a server's complaint about itself
reaches the model — and its answer is why a design went the way it did. Probes
are not shipped and are not part of an adopter's environment. They are in
`merge.governed_paths`, which they inherited from the `scripts/**` they were
split out of.

## Open questions

Each entry is a place where the model and the code disagree and the fix needs a
decision rather than an edit. Add to this list rather than forcing a shape.

### `Turn` does not exist

The work domain's central noun is missing. One agent's attempt to advance one
node — how it ended, what it produced, who it named next — is spelled as bare
strings in five places (`nextAgent`, `directive`, `reviewer`, `agent`, the
mention), with "no next" written as `directive === ""`. `control-commands.ts`
already describes the enum in prose — a stop "is the same terminal state as an
agent that finished its turn, ran out of time, or hit the handoff limit" — and
then has nowhere to put it.

Two consequences, both live: `DISPATCH_NEXT_GUARD` in `atomaton-runner.wac.ts`
decides "does the chain continue" as an Actions expression, thirty lines below
a step that asks the domain the same question with the same four inputs;
and the only persisted history type is `RunRecord`, so *how long did this run
take* is answerable and *how long did #42 take* is not.

Introducing the type is an atomaton-only change. Having the run report its own
ending, rather than having bash infer it from an exit code and the presence of a
stop file, is a change to the protocol with `atoma` and is not in scope here.

### `issue-branch.ts` fuses a rule with a convention

*Resume the existing branch or cut a new one* is a work rule. `atomaton/issue-N`
is a naming convention, which is mechanism. They are one module.

### `pr-validation.ts` returns three answers at once

Who runs next (work), what the check context is (mechanism), and whether the
deliverable is trusted (machinery), in one return value.

### `shipped-servers.ts` and `tools-file.ts` import each other

A cycle inside `domain/machinery/`.

### Three implementations of one cap

`session-size.ts` says so itself: the same rule lives there, in `tool-output.ts`,
and in the core's `domain::tool_output`. Two of the three are ours.

### Local changes under `.github/atomaton-runtime/` vanish silently

`build-dist.ts` removes the tree and rebuilds it, and the release manifest
records the version and the shipped paths but no content hash. An adopter who
edits the machinery loses the edit at the next update with nothing reporting it.
`docs/edd.md` asks that drift be visible.

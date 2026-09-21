# `merge`

Three members, and every one of them composes: any one firing puts the merge in a
person's hands.

## `merge.policy`

`manual` means an agent never merges. `auto` means it may, when nothing else
objects — the two members below are the something else.

## `merge.governed_paths`

An agent will not merge a pull request that changes how agents run. It reviews
it and reports, and the merge is yours.

Covered by default:

```text
.github/**
```

A pattern is a literal path or a directory followed by `/**` — the same two forms
`merge.gates` accepts, and the only two.

**The list replaces the default rather than extending it:**

```yaml
merge:
  governed_paths:
    - ".github/**"
    - "infra/**"
```

Set it to `[]` to turn the gate off. If you deliberately want a corner of
`.github/` back — issue templates, say — name the parts you do want governed
instead. Prefer that to a narrower default: being explicit about the exception
leaves a record of the decision.

[Why the whole directory](boundaries.md#why-the-whole-directory), and what this
gate does *not* cover, are separate questions with answers of their own.

## `merge.gates`

`merge.governed_paths` covers Atomaton's own machinery. Your project has its own
things that should not land unread — a database migration, a change to a pricing
table, a release note — and they are not describable as a path alone. "Anything
under `db/migrations/`" is sayable; "only when a migration is **added**" is not.

`merge.gates` is that, and it behaves exactly like the gate above: the agent
reviews the pull request, posts the review, and says it is ready for a person.
The merge is yours.

```yaml
merge:
  gates:
    - reason: "This adds a database migration. Please check it before merging."
      when:
        files_added: ["db/migrations/**"]
```

`reason` is written to a person and relayed to them verbatim, in whatever
language you write it in. It is the whole output of the gate, so say what you
want checked rather than restating the condition.

**Conditions.** Every one you name must hold, so one gate is one situation.
Several gates are several situations.

| Condition | Matches when |
| --- | --- |
| `files_added` | a file the pattern claims was added (a rename into it counts) |
| `files_removed` | a file the pattern claims was deleted (a rename out of it counts) |
| `files_modified` | an existing file the pattern claims changed |
| `files_changed` | any of the three — what `merge.governed_paths` matches on |
| `labels` | the pull request carries any one of these labels |
| `title_matches` | the title matches this regular expression, case-insensitively |

Patterns take the same two forms as `merge.governed_paths` and no others.
Anything else, `**/*.sql` included, is rejected when the file is read rather than
quietly matching nothing.

**Mistakes are errors, not silence.** A misspelled condition, a pattern this
matcher cannot honour, a gate with no conditions at all: each stops the merge and
says why, instead of producing a gate that never fires. A gate that never fires
looks exactly like a gate you did not need, and you would find out from the merge
that went through. For the same reason a gate that cannot be read blocks rather
than disappearing — otherwise the way past a gate would be to break it.

The labels here are labels a **person** applies to a pull request. They are not
`chain.labels`, which are
[state one run leaves for the next](../work/reference.md#chainlabels).

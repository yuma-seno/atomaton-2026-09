# Write a skill

A skill is a set of instructions this project has written for a particular kind of
work, loaded on demand rather than carried by every run. It lives under
`.github/atomaton/skills/<category>/<name>.md`, and `<category>/<name>` is the
name an agent asks for with `atoma_builtin__load_skill`.

## When a skill rather than the role prompt

The role prompt is what every run of an agent carries. A skill is what only some
runs need. So the test is whether the work in front of a run is of a kind the
instructions cover:

- **A skill** — a procedure for a situation that arises sometimes: a dependency is
  missing, the answer is not in the repository, a pipeline has to be set up.
- **The role prompt** — what is true of every run of that agent: what it is for,
  what it must not do, which outcome ends a run.

A check that is not optional does not belong behind an optional load. The
reviewer's mandatory checks are in its definition for exactly that reason: two
lines of one file asked for the same step by two mechanisms, and the one behind
the load was obeyed 43 times out of 227.

## The file

```markdown
---
name: research/web-search
description: Load when the answer is not in your repository — fetching a page whose address you know, and running a general search when you do not.
---

# Looking outside your repository

...
```

`name` is the name an agent asks for, and `description` is what the catalog shows
— it is the whole of what an agent sees before loading, so it has to say when to
load the skill, not what the skill contains. The body is the instructions, and it
arrives only when the agent asks.

## What ships, and what is yours

The template ships a few skills as a starting point, and `skills/project/` is
yours outright — an upgrade will not fight you for it. The shipped ones are
defaults the template also expects you to tune, so a change there is either an
improvement you have not taken or a change you made on purpose, and the two look
identical. [What an upgrade replaces, and what is
yours](../../runtime/boundaries.md) is the whole rule.

## Checking it

Every skill needs a `name`, a `description` and a non-empty body, and no two may
share a name. `bun test` holds that, and the pull request's own check runs it.

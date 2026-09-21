# What GitHub's own settings protect

Two of the things a run depends on are not in `config.yaml`, are not in the
deliverable, and cannot be put there. They are settings on the repository, and
the only thing this project can do about them is say so.

## A workflow cannot grant itself what the repository withholds

The generated workflows declare their own `permissions` — `actions`, `issues`,
`pull-requests` and `contents`, set to write where a job needs it. That block
narrows what the job's `GITHUB_TOKEN` may do. It does not widen it.

So **Settings > Actions > General > Workflow permissions** is above all of them,
and reading the declared block is not evidence that the repository-level setting
is on. A workflow that asks for `pull-requests: write` in a repository that
allows Actions no pull requests gets a token that cannot open one, and the
failure arrives where the agent tried to use it rather than where the permission
was refused.

## No job can apply a branch ruleset, and none can report that it was not applied

A ruleset is not read from the repository. It is a server-side setting, and
`.github/atomaton/rulesets/main.json` is the reviewed declaration of what that
setting should be — a file, not an effect. Something has to carry it across, and
that something is a person with admin:

- Creating or updating a ruleset goes through the repository administration API,
  and `administration` is not a permission a workflow can grant `GITHUB_TOKEN`.
  There is no job that could do it, whatever it was allowed to declare.
- A check could only report it, never enforce it — and it could not even report
  it usefully. If the ruleset were missing then `atomaton-check` would no longer
  be a required context either, so a check that went red would block nothing.

That is the one step of adoption with no failure mode: it does not go wrong, it
goes unnoticed. [Make a branch ruleset work with
agents](tasks/make-a-branch-ruleset-work-with-agents.md) is the procedure, and
what the rules decide once they are in place is [what the merge gate
stops](../pull-requests/boundaries.md).

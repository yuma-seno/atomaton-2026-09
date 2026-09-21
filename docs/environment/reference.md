# The environment a run works in

Two keys describe the runner every job starts on — the agent's own run, the
checks, and the deployments alike.

## `environment.setup_commands`

A list of shell commands, run before checks, before deployments, and before an
agent starts — all three, on a cold runner every time. They go through `bash -c`,
in order, and stop on first failure. One declaration, three jobs.

Nothing here receives a secret. Setup runs before any credential enters the
environment, in all three jobs.

The template ships it empty on purpose: it is language- and framework-agnostic,
and only you know what your project needs. Agents are told to treat the runner as
already provisioned and never to spend iterations installing or configuring
tooling themselves, so anything they need at run time belongs here. Filling it in
is [step 4 of setup](../setup.md).

**Why here rather than at the front of `checks.from_pull_request`.** That works,
and it drifts: the agent's shell and CI then install their dependencies from two
places, and a test that passes for the agent and fails in CI reaches an engineer
as a defect that does not reproduce on the machine they can see.

This key is for the project. What a tool server of **yours** needs installed goes
in [`tools.packages`](../tools/reference.md#toolspackages) instead.

## `environment.max_reloads`

How many times one piece of work may rebuild its environment.

```yaml
environment:
  max_reloads: 3
```

Three by default, the same as `CI_RETRY_LIMIT`. `0` means the default, not
"never" — to stop reloading entirely, remove `atomaton_env` from an agent's
`mcp_servers` in its definition.

It sits here rather than beside the counters in `chain` because of where the
refusal goes: this one is returned to the **agent**, mid-run, and the agent
carries on. The `chain` counters stop a run and hand the work to a person.

What a reload actually does, what it cannot conjure, and what happens at the cap
are in
[when the environment is missing something](how-it-works.md).

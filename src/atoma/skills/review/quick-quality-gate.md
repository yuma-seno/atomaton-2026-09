---
name: review/quick-quality-gate
description: Load before reporting on a pull request — a quick pass for concrete correctness, security, contract, and regression failures.
---

# Quick Quality Gate

Review for merge-blocking defects, not optional polish.

1. Inspect prior review rounds to understand loop state.
2. Read the PR diff and identify changed behavioral contracts.
3. Check for incorrect control flow, unsafe input or command handling, stale generated output, broken compatibility, and missing regression coverage.
4. Run the mandatory checks below for whichever categories the diff touches.
5. Distinguish evidence-backed defects from stylistic preferences.
6. If sound, submit the required LGTM review and follow the configured merge policy.
7. If defective, return a concise engineer directive naming the behavior, location, and expected correction.
8. Escalate rather than continuing an exhausted review loop.

Do not broaden into unrelated architecture review. A finding must describe a concrete failure mode or requirement violation.

## Mandatory checks

These are not optional reads. Each covers a failure that a diff-only review
cannot see, because the evidence lives in a file the diff does not contain.

### Anything removed

A diff that deletes a named thing — a YAML key, a list entry, a file, an exported
symbol, a config field — is only safe once you have looked for its users
yourself.

- Search the repository for the exact name with `github__search_code`, and read
  any file that plausibly references it with `filesystem_readonly__read_file`.
- "Unused", "dead", or "never exposed" in a PR description is a claim, not
  evidence. Verify it or reject it. An author sees the surface they were working
  on; a consumer in another file is exactly what they cannot see.
- If a search is not possible, the removal is unverified. Say so and return it.

### `tools.servers` or an agent definition changed

Read **all** of `.github/atoma/agent-definitions/*.md`, not just the one in the
diff.

Every name under an agent's `mcp_servers` has to resolve to a server the run will
start, and two things provide one: the servers Atoma ships, which are **not** in
`config.yaml` and cannot be removed, and whatever `tools.servers` adds. **So a
name absent from `tools.servers` is not a finding** — every shipped name is absent
from it, and in most repositories that section is empty. What decides is
`atoma validate`, which the required check on the pull request already runs
against that pull request's own config: it fails on a name nothing provides, and
lists the servers that do exist. Do not repeat that check by eye, and do not
reject a definition because a name is missing from the config.

What that check cannot judge is the part to spend your reads on:

- A server the diff **removes or renames** under `tools.servers` is one an agent
  may still name. Search every definition for the old name before accepting it.
- An entry whose name is one Atoma ships is an **override**, merged field by
  field. One that pastes the whole shipped entry to change a single field is a
  defect worth returning: the pasted fields stop tracking the upstream ones.
- A server that spawns a command which is not `bun` needs that binary installed by
  the runner. Confirm the package appears under `tools.packages` in the same
  config. The shipped servers' packages are in the deliverable, not there, so a
  diff that adds one of those to the config is the wrong half of the tree.

No tools file ships: the one `atoma` is handed is written at the start of each run
from the shipped servers plus `tools.servers`, and deleted with the runner. So a
diff that adds a `tools/tools.yaml`, or edits one an older release left behind, is
a defect whatever it says — nothing reads that file, and the change it was meant
to make never happens. Require it in `config.yaml`.

### Generated output touched

Some files are produced by a build rather than written by hand.

- An edit made directly to one is a defect even when its content is correct. The
  next build overwrites it, so the change it was meant to make is silently lost.
  Require the change in the source the generator reads.
- When the project regenerates and commits that output itself, a diff carrying it
  is also a defect: concurrent branches collide in files no human wrote, and a
  regenerated bundle buries the real change under a far larger diff.
- Establish which convention the project follows before ruling, rather than
  assuming. The build configuration states it.

### Workflow or runner changed

Trace the values a new step depends on. A step that reads a file must have that
file guaranteed present in the deployed tree, not merely present in the branch
where it was authored.

# State for issue #788 / PR #802 — the review fix could not be pushed

## What is done

The review's two findings are fixed, validated, and **committed locally** at
`82ccf54a195b8af0c70540a3d556e23e77a3e6d7` on top of `11084af` (the PR head).

`review-fix.patch` is that commit as a patch (`git diff 11084af..82ccf54`). It
applies cleanly to the PR head tree.

Changed:

- `src/atomaton-runtime/tools/defaults.yaml` — the shipped `files_readonly` comment
  no longer claims the allowlist is checked before *the reader's* release. It offers
  `--with-live-tools` as something a project can wire and says nothing runs it for
  them.
- `docs/operations.md` — both new paragraphs no longer say the live half "runs … in
  the release". They say nothing delivered runs it, present this repository's own
  release as a worked example, and point an adopter at their own
  `deploy.atomaton_runs.targets`.
- `tests/contract/live-tools-check.test.ts` — three added tests holding the corrected
  claims: nothing under `src/`/`self/` references the check; the shipped comment says
  nothing runs it for that reader; the adopter-facing page does not claim the
  reader's release runs it (including the two wrong phrasings).

Validated: `bun run typecheck` clean, `bun run synth` ok, `bun run test` 972 pass /
0 fail, `bun run test:e2e` 3 pass 5 skip 0 fail, `bash scripts/check-live-tools.sh`
exit 0. Mutation checks confirmed each new test fails on the reviewed-as-false text.

## Why it is not on the PR

`github__commit_and_push` failed:

```
Error: fatal: invalid refspec '(HEAD detached at pull/802/head)'
```

This run is a pull request run (`ATOMATON_RUN_TYPE=pr`), dispatched by
`atomaton-validate-pr.yml` → `atomaton-runner.yml`, which checks out
`refs/pull/802/head` — detached, with no local branch. In `commitAndPush`:

1. `branchForCommit()` — `rev-parse --abbrev-ref HEAD` is `HEAD`, not an
   `atomaton/issue-` branch; `runIssueNumber()` returns undefined because
   `ATOMATON_RUN_TYPE !== "issue"`; so it falls through to `resolveBranch()`.
2. `resolveBranch()` — `BRANCH` env is the literal string `HEAD` (the runner's "Set
   branch env for PR type" step writes `git rev-parse --abbrev-ref HEAD`), so step 1
   is skipped; `rev-parse` gives `HEAD`, skipped; step 3,
   `git branch --format='%(refname:short)' --points-at=HEAD`, returns git's
   detached-HEAD *description* rather than a branch name:

   ```
   (HEAD detached from pull/802/head)
   ```

3. `git push -u origin "(HEAD detached at pull/802/head)"` → invalid refspec.

No tool can publish from here: raw `git push`/`checkout`/`switch` are refused by
`shell_guard.ts` (routed to the MCP tools), and `github__sync_branch` refuses with
"Cannot synchronize 'atomaton/issue-788' while 'detached HEAD' is checked out."

This is the gap issue #247 recorded on 2026-08-15 — an engineer dispatched to fix a
red CI cannot push its fix — still present.

## What the next run needs

If a run is started on issue #788 (`ATOMATON_RUN_TYPE=issue`), `branchForCommit`
will find `atomaton/issue-788` already exists remotely, create a local branch for
it, and `commit_and_push` will work. Failing that, a person can apply
`review-fix.patch` to the branch.

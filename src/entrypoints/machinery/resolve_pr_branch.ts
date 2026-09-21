#!/usr/bin/env bun
/**
 * resolve_pr_branch.ts — the head branch of the pull request a `pr` run is on.
 *
 * A `pr` run checks the pull request out through `refs/pull/N/head`, and that is
 * not a branch: `actions/checkout` fetches it to `refs/remotes/pull/N/head` and
 * checks *that* out, so git leaves the run detached and
 * `git rev-parse --abbrev-ref HEAD` answers `HEAD`. There was therefore nothing
 * for `commit_and_push` to push to, and it built a refspec out of git's own
 * description of the state --
 *
 *     fatal: invalid refspec '(HEAD detached at pull/802/head)'
 *
 * -- so the one agent whose job is to push a fix onto a red pull request was the
 * one that could not. Observed twice: #247, and the run that filed #803.
 *
 * This is the counterpart of `resolve_issue_branch.ts`. It answers *which* branch
 * the pull request is already from; the workflow step beside it materialises that
 * branch at the commit the run already has. A script rather than inline bash
 * because the decision is the part that can be wrong, and this way it is decided
 * where it can be tested without a runner.
 *
 * Best-effort, in the same way and for the same reason: nothing here fails the
 * run. An empty `branch` output means this run has no branch it may push to, it
 * stays on the detached checkout, and the tool that needs a branch refuses with a
 * message saying what the run cannot do. Stopping before the agent has said
 * anything would be worse than that.
 *
 * Usage:
 *   resolve_pr_branch.ts --repo owner/name --number 12
 *
 * Writes `branch=<name-or-empty>` to $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh, gitRun } from "../../adapters/github/gh.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ResolvePrBranchArgs {
  repo: string;
  number: string;
}

export const ref = defineScript<ResolvePrBranchArgs>(import.meta.url);

function log(message: string): void {
  console.error(`[atomaton-pr-branch] ${message}`);
}

/** What `gh pr view` was asked for, and what an unreadable answer means. */
export interface PrHead {
  branch: string;
  /** True when the head branch lives in a fork rather than in this repository. */
  crossRepository: boolean;
}

/**
 * Read the head branch out of `gh pr view --json headRefName,isCrossRepository`.
 *
 * Pure, and forgiving on purpose: an answer that cannot be parsed is one of the
 * ways this run ends up with no branch, not an exception. The fork flag is
 * carried separately from the name because the two refusals are different facts
 * about the pull request, and whoever reads the log needs to tell them apart.
 */
export function prHead(prJson: string): PrHead {
  try {
    const pr = JSON.parse(prJson) as { headRefName?: unknown; isCrossRepository?: unknown };
    return {
      branch: typeof pr.headRefName === "string" ? pr.headRefName.trim() : "",
      crossRepository: pr.isCrossRepository === true,
    };
  } catch {
    return { branch: "", crossRepository: false };
  }
}

/**
 * Whether a name may be checked out as a branch, asked of git rather than
 * pattern-matched.
 *
 * `check-ref-format --branch` is the same rule `git checkout` and `git push`
 * apply, so a name it accepts cannot be one they refuse, and one it rejects never
 * reaches the `git checkout` the caller runs. That covers the empty name; `HEAD`
 * — not a branch, and exactly what the step this replaces used to write; names
 * carrying whitespace or a control character, which would otherwise split into
 * extra refspecs or extra `$GITHUB_ENV` lines; and `..`, `~`, `^`, `:`, `\`,
 * `@{`, `.lock` or a leading `-`.
 */
export function isBranchName(name: string): boolean {
  if (!name) return false;
  return gitRun("check-ref-format", "--branch", name).code === 0;
}

/**
 * Whether the branch is one `origin` has.
 *
 * A pull request's `headRefName` names a branch in its head repository, which for
 * a fork is not `origin`. Asking first is what turns "the checkout fails" into
 * "this run stays detached", and it is what stops a fork's branch from being
 * taken for a branch of the same name in this repository -- which is the branch a
 * push would then land on.
 */
export function existsOnOrigin(name: string): boolean {
  const { code, stdout } = gitRun("ls-remote", "--heads", "origin", `refs/heads/${name}`);
  return code === 0 && stdout.trim() !== "";
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" }, number: { type: "string" } },
  });

  const repo = (values.repo ?? "").trim();
  const number = Number((values.number ?? "").trim());
  const githubOutput = process.env.GITHUB_OUTPUT;

  // Never exits non-zero. Every path below either resolves a name or resolves
  // nothing, and says on stderr which of the two happened and why.
  let branch = "";
  if (!repo || !Number.isInteger(number) || number <= 0) {
    log("missing --repo or --number; this run has no branch to check out");
  } else {
    const { code, stdout, stderr } = gh(
      "pr", "view", String(number), "--repo", repo,
      "--json", "headRefName,isCrossRepository",
    );
    if (code !== 0) {
      log(`could not read pull request #${number}: ${stderr || stdout}`);
    } else {
      const head = prHead(stdout);
      if (head.crossRepository) {
        log(
          `pull request #${number} comes from a fork, so its head branch is not a branch of this repository; ` +
            "this run stays on the detached checkout",
        );
      } else if (!head.branch) {
        log(`pull request #${number} names no head branch`);
      } else if (!isBranchName(head.branch)) {
        log(`pull request #${number} names '${head.branch}', which is not a branch name`);
      } else if (!existsOnOrigin(head.branch)) {
        log(`'${head.branch}' does not exist on origin; this run stays on the detached checkout`);
      } else {
        branch = head.branch;
      }
    }
  }

  log(
    branch
      ? `the pull request's head branch is ${branch}`
      : "no head branch to check out; staying on the detached checkout",
  );
  if (githubOutput) appendFileSync(githubOutput, `branch=${branch}\n`);
}

if (import.meta.main) main();

#!/usr/bin/env bun
/**
 * plan_checks.ts — one arm of `checks`, as a matrix.
 *
 * A workflow cannot read a file to decide its own jobs, so the list is published as a
 * job output and consumed with `fromJSON`. Each entry becomes one GitHub job, which is
 * what lets a job carry its own runner and — where the arm allows it — its own
 * secrets.
 *
 * ## Which configuration this reads
 *
 * Whichever tree the job that runs this checked out, and the two arms are deliberately
 * planned by two jobs for that reason.
 *
 * `from_pull_request` is planned from the PULL REQUEST's tree: they are its commands,
 * and it may change them freely, because no secret reaches them.
 *
 * `from_default_branch` is planned from the DEFAULT BRANCH's tree, and that is the
 * whole point of the arm. A pull request that could add a job, rename one, or widen
 * one's `secrets` would be a pull request choosing what it may reach.
 *
 * ## An empty list is an answer
 *
 * A project with no checks in an arm publishes `[]`, GitHub skips the matrix job, and
 * the job that aggregates the verdicts treats `skipped` as a pass. A malformed list is
 * NOT the same thing: it fails here, because a check that could not be planned must not
 * read as a check that found nothing to do.
 *
 * Usage:
 *   plan_checks.ts --arm pull-request|default-branch
 */
import { CHECKS_FROM_DEFAULT_BRANCH, CHECKS_FROM_PULL_REQUEST, NO_PULL_REQUEST_CHECKS } from "../domain/check-jobs.ts";
import { getDefaultBranchChecks, getPullRequestChecks } from "../lib/config.ts";
import { parseAcrossReleases } from "./lib/cli.ts";
import { publishMatrix } from "./lib/publish-matrix.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface PlanChecksArgs {
  arm: string;
}

export const ref = defineScript<PlanChecksArgs>(import.meta.url);

const ARMS = {
  "pull-request": { read: getPullRequestChecks, key: CHECKS_FROM_PULL_REQUEST.where, warnWhenEmpty: NO_PULL_REQUEST_CHECKS },
  "default-branch": { read: getDefaultBranchChecks, key: CHECKS_FROM_DEFAULT_BRANCH.where, warnWhenEmpty: "" },
} as const;

export function main(): void {
  // Tolerant of a flag it has not learned yet: the default-branch arm is planned from
  // a tree that may be an older release than the workflow running it. See
  // `parseAcrossReleases`.
  const values = parseAcrossReleases(["arm"], Bun.argv.slice(2));
  const arm = ARMS[(values.arm ?? "") as keyof typeof ARMS];
  if (!arm) {
    console.error(`usage: plan_checks.ts --arm ${Object.keys(ARMS).join("|")}`);
    process.exit(2);
  }

  const { jobs, problems } = arm.read();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error(`::error::\`${arm.key}\` could not be read, so none of its checks ran.`);
    process.exit(1);
  }

  publishMatrix(jobs, { what: `\`${arm.key}\` job`, warnWhenEmpty: arm.warnWhenEmpty });
}

if (import.meta.main) main();

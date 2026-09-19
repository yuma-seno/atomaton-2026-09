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
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getDefaultBranchChecks, getPullRequestChecks } from "../lib/config.ts";
import { runsOnOutput } from "../domain/runner-label.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface PlanChecksArgs {
  arm: string;
}

export const ref = defineScript<PlanChecksArgs>(import.meta.url);

const ARMS = {
  "pull-request": {
    read: getPullRequestChecks,
    key: "checks.from_pull_request",
    /**
     * Said only for this arm, because only here is an empty list surprising.
     *
     * A project that declares no credentialed check is the shipped default and the
     * common case. A project that declares nothing to verify a change with has a
     * required check that passes every pull request without looking at it, which is
     * the shape this repository keeps finding: cover that is not.
     */
    warnWhenEmpty:
      "This check verified nothing: `checks.from_pull_request` in .github/atomaton/config.yaml is empty, " +
      "so a pull request satisfying it has not been tested. Add the commands that check this project, " +
      "or point `checks.your_workflow` at a workflow of your own.",
  },
  "default-branch": {
    read: getDefaultBranchChecks,
    key: "checks.from_default_branch",
    warnWhenEmpty: "",
  },
} as const;

export function main(): void {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { arm: { type: "string" } } });
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

  // `include` is what a matrix takes, and each entry carries everything its job needs:
  // the name GitHub shows, the machine, the commands, and the secret names that job —
  // and only that job — is handed.
  //
  // `runs_on` is JSON rather than a bare label so the consumer is always
  // `fromJSON(...)`, with no branch that behaves differently for one label than for
  // three. See `runsOnOutput`.
  const include = jobs.map((job) => ({
    name: job.name,
    runs_on: runsOnOutput(job.runsOn),
    commands: job.commands,
    secrets: job.secrets,
  }));

  const output = process.env.GITHUB_OUTPUT;
  const line = `jobs=${JSON.stringify(include)}\n`;
  if (output) appendFileSync(output, line);
  else process.stdout.write(line);

  if (include.length === 0) {
    console.error(arm.warnWhenEmpty ? `::warning::${arm.warnWhenEmpty}` : `No \`${arm.key}\` checks are declared.`);
    return;
  }
  console.error(`${include.length} \`${arm.key}\` job(s): ${include.map((job) => job.name).join(", ")}`);
}

if (import.meta.main) main();

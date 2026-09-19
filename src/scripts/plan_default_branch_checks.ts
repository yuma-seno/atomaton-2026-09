#!/usr/bin/env bun
/**
 * plan_default_branch_checks.ts — the credentialed check jobs, as a matrix.
 *
 * `checks.default_branch_runs.jobs` becomes one GitHub job each, so a repository
 * secret reaches the single check that named it rather than every check the project
 * has. A workflow cannot read a file to decide its own jobs, so the list is published
 * as a job output and consumed with `fromJSON` — the same shape `pick-runner` uses to
 * decide `runs-on`.
 *
 * ## Which configuration this reads, and why it is the whole point
 *
 * The DEFAULT BRANCH's, because this decides which credential goes where. A pull
 * request that could add a job, rename one, or widen one's `secrets` would be a pull
 * request choosing what it may reach — and the commands these jobs run come from the
 * default branch for the same reason. The pull request reaches them as a path to
 * read, never as something to execute.
 *
 * Its own commands run in the other half, `checks.pull_request_runs`, where no secret
 * goes and there is nowhere to name one. Neither half can be given both, which is why
 * neither has to be trusted with the other's job.
 *
 * ## An empty list is an answer
 *
 * A project with no credentialed check publishes `[]`, GitHub skips the matrix job,
 * and the job that aggregates the verdicts treats `skipped` as a pass. A malformed
 * list is NOT the same thing: it fails here, because a check that could not be
 * planned must not read as a check that found nothing to do.
 */
import { appendFileSync } from "node:fs";
import { getInspectJobs } from "../lib/config.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

export function main(): void {
  const { jobs, problems } = getInspectJobs();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error("::error::`checks.default_branch_runs.jobs` could not be read, so no credentialed check ran.");
    process.exit(1);
  }

  // `include` is what a matrix takes, and each entry carries everything its job
  // needs: the name GitHub shows, the commands to run, and the secret names that
  // job — and only that job — is handed.
  const include = jobs.map((job) => ({
    name: job.name,
    commands: job.commands,
    secrets: job.secrets,
  }));

  const output = process.env.GITHUB_OUTPUT;
  const line = `jobs=${JSON.stringify(include)}\n`;
  if (output) appendFileSync(output, line);
  else process.stdout.write(line);

  console.error(
    include.length === 0
      ? "No credentialed checks are declared, so none will run."
      : `${include.length} credentialed check job(s): ${include.map((job) => job.name).join(", ")}`,
  );
}

if (import.meta.main) main();

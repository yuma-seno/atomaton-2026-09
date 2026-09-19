/**
 * publish-matrix.ts — hand a list of declared jobs to GitHub as a matrix.
 *
 * Both planning scripts end the same way, and the shape of what they publish is a
 * contract with the generated workflow rather than a detail of either: the matrix
 * `include` entries have to carry exactly the fields `actions/declared-job.ts` reads
 * back out of `matrix.*`. Two copies of that would agree until one of them gained a
 * field.
 */
import { appendFileSync } from "node:fs";
import type { DeclaredJob } from "../../domain/declared-jobs.ts";
import { runsOnOutput } from "../../domain/runner-label.ts";

export interface PublishMatrixOptions {
  /** What one entry is, for the line saying how many there were — "`deploy` job". */
  readonly what: string;
  /**
   * Said instead of the ordinary line when the list is empty, where empty is
   * surprising. Most lists are ordinarily empty and say nothing.
   */
  readonly warnWhenEmpty?: string;
}

/** Write `jobs=<JSON>` to the step's output, and say on the log what was published. */
export function publishMatrix(jobs: readonly DeclaredJob[], options: PublishMatrixOptions): void {
  // Each entry carries everything its job needs: the name GitHub shows, the machine,
  // the commands, and the secret names that job -- and only that job -- is handed.
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
    console.error(
      options.warnWhenEmpty ? `::warning::${options.warnWhenEmpty}` : `No ${options.what}s to run.`,
    );
    return;
  }
  console.error(`${include.length} ${options.what}(s): ${include.map((job) => job.name).join(", ")}`);
}

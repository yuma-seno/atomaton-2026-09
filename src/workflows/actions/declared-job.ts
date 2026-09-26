/**
 * declared-job.ts — the job a `domain/delivery/declared-jobs.ts` entry becomes.
 *
 * Two workflows build one from a matrix: `atomaton-check` for a check, `atomaton-deploy`
 * for a deployment. What they do with it differs — one judges a pull request, the
 * other ships — but the job itself is the same three things every time: it is named
 * after its entry, it runs on the machine that entry asked for, and it runs that
 * entry's commands with that entry's credentials and nobody else's.
 *
 * Written out twice, the third of those is the one that goes wrong quietly. A slot
 * keyed off the wrong expression hands a job a credential it did not declare, or
 * hands it none and fails somewhere further in; neither reads as a mistake in the
 * YAML. So the expressions are built here, once, from the same constants the
 * validator uses.
 */
import { type GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";
import { DefinedJob, JobCondition } from "./base.ts";
import { SECRET_NAMES_VAR, SECRET_SLOT_PREFIX, SECRET_SLOTS } from "../../domain/delivery/declared-secrets.ts";

/** The entry's commands, as JSON, for the loop below to run in order. */
export const COMMANDS_VAR = "ATOMATON_COMMANDS";

/**
 * Run the entry's commands in order, stopping at the first failure.
 *
 * `matrix.commands` rather than a script reading configuration: the list was already
 * decided by the planning job, from the tree that owns it, and reading it twice is
 * how the two answers come to disagree.
 */
export const RUN_DECLARED_COMMANDS = [
  `echo "$${COMMANDS_VAR}" | jq -r ".[]" | while IFS= read -r command; do`,
  '  echo "::group::$command"',
  '  if ! bash -c "$command"; then',
  '    echo "::endgroup::"',
  '    echo "::error::${{ matrix.name }}: $command"',
  "    exit 1",
  "  fi",
  '  echo "::endgroup::"',
  "done",
  "",
].join("\n");

/**
 * The credentials this matrix entry declared, and no others.
 *
 * Each slot is keyed by a name the entry named, so a job is handed its own. An entry
 * naming fewer than the maximum leaves the rest empty, which is what an unset secret
 * looks like anyway. `renameSecretSlots()` puts the declared names back on before the
 * first command runs.
 */
export function matrixSecretEnv(): Record<string, string> {
  return {
    ...Object.fromEntries(
      Array.from({ length: SECRET_SLOTS }, (_, slot) => [
        `${SECRET_SLOT_PREFIX}${slot}`,
        `\${{ secrets[matrix.secrets[${slot}]] }}`,
      ]),
    ),
    [SECRET_NAMES_VAR]: "${{ toJSON(matrix.secrets) }}",
  };
}

/**
 * One GitHub job per entry a planning job published.
 *
 * `fromJSON(matrix.runs_on)` always, so one label and a self-hosted runner's several
 * are consumed the same way -- see `domain/delivery/runner-label.ts`.
 *
 * `if: … != '[]'`, because a matrix over an empty list is an error rather than an
 * empty job. A project that declared none of these publishes an empty list, and
 * whatever reads the outcome treats `skipped` as "there was nothing to do".
 *
 * `planJob` is the job itself, not its name. It was a name, and a name is a string
 * that nothing checks: a `needs:` entry naming nothing is not an error to GitHub,
 * it is a dependency that does not exist, so the matrix job would run immediately
 * and read `jobs` from a job that never ran. Taking the job is what makes the
 * typo a compile error, and it is the same argument `JobOutputRef` makes about
 * reading an output.
 */
export function matrixJob(
  jobName: string,
  planJob: DefinedJob<{ jobs: string }>,
  options: {
    readonly timeoutMinutes: number;
    readonly failFast: boolean;
    readonly maxParallel?: number;
    readonly permissions: Readonly<Record<string, string>>;
  },
  steps: readonly unknown[],
): DefinedJob {
  return new DefinedJob(
    jobName,
    {
      // Named, because GitHub builds a matrix job's name from EVERY field of its
      // entry when it is not. Measured on the first run of this shape:
      //
      //   pull-request-checks (verify, ["ubuntu-latest"], bun run src/entrypoints/machinery/scan_…
      //
      // — truncated by the UI, and the one part a person needs is the entry's name,
      // which is buried among the commands and the runner. That name is also what a
      // failing job reports itself as, so it is the whole of what somebody sees when
      // they are looking for which one went wrong.
      name: `${jobName} (\${{ matrix.name }})`,
      needs: [planJob],
      if: JobCondition.isNot(planJob.rawOutputs.jobs, "[]"),
      "runs-on": "${{ fromJSON(matrix.runs_on) }}" as unknown as string,
      "timeout-minutes": options.timeoutMinutes,
      permissions: options.permissions,
      strategy: {
        "fail-fast": options.failFast,
        ...(options.maxParallel === undefined ? {} : { "max-parallel": options.maxParallel }),
        matrix: { include: `\${{ fromJSON(${planJob.rawOutputs.jobs}) }}` },
      },
    },
    steps as never[],
  );
}

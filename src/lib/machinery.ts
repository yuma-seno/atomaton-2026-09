/**
 * machinery.ts — which tree the deployed machinery is in, for this process.
 *
 * Every path in `domain/machinery-layout.ts` is relative. What they are relative to
 * was resolved in three places, by hand, with three spellings: `lib/config.ts` wrote
 * `root ? `${root}/${CONFIG_FILE}` : CONFIG_FILE`, while `check_live_tools.ts` and
 * `write_metrics_report.ts` each wrote `process.env.ATOMATON_MACHINERY_ROOT?.trim()
 * || "."` and then interpolated it into six and three path strings respectively.
 *
 * Same answer, three times, none of them able to change together — and the variable's
 * name typed out beside each. This is the one place that reads it.
 *
 * ## It resolves a path; it does not decide trust
 *
 * Whether the tree it names may be believed is a property of the JOB, not of the
 * reader — the runner sets the variable so a pull request cannot choose how the agent
 * reviewing it behaves; `atomaton-check` leaves it unset so the pull request's own
 * arm reads the pull request's own commands. `MACHINERY_ROOT_VAR`'s own comment holds
 * the whole table.
 *
 * The one read that must never fall back to the job's checkout — which credentials a
 * run may reach — does not come through here at all. It refuses to resolve a path and
 * is handed one, so a variable that went missing cannot downgrade it: see
 * `scripts/read_secret_names.ts`.
 */
import { MACHINERY_ROOT_VAR } from "../domain/machinery-layout.ts";

/**
 * The tree the machinery was put in, or undefined when nothing moved it.
 *
 * Undefined rather than `"."`, so a caller that has something to say about not being
 * told can say it. `machineryPath` is what turns it into a path, and every caller so
 * far wants that.
 */
export function machineryRoot(): string | undefined {
  return process.env[MACHINERY_ROOT_VAR]?.trim() || undefined;
}

/**
 * A `machinery-layout.ts` path, resolved against whichever tree holds the machinery.
 *
 * Unset means the job's own checkout, which is what every workflow but the runner
 * wants: the path is left relative and resolves against the working directory. That
 * is also why this returns `CONFIG_FILE` rather than `./CONFIG_FILE` — the strings
 * appear in error messages a person reads, and the leading `./` was never there.
 */
export function machineryPath(relative: string): string {
  const root = machineryRoot();
  return root ? `${root}/${relative}` : relative;
}

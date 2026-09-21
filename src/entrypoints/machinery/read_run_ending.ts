#!/usr/bin/env bun
/**
 * read_run_ending.ts — asks the run how it ended, instead of guessing from outside.
 *
 * The core records this itself. `atoma`'s runner classifies every ending —
 * `completed`, `iterations`, `runtime`, `stopped`, `failed` — and writes it into the
 * session it just saved, as the last entry of `atoma_runs`. `write_metrics_report.ts`
 * has been reading those records for some time.
 *
 * The runner was not. It read the exit code, saw `2`, and then tested whether the
 * stop file existed:
 *
 *     if [ -f "${STOP_FILE}" ]; then stop_requested=true; else limit_reached=true; fi
 *
 * with a comment saying only this job could tell the two apart, "because only this
 * job asked". That was never true — the run knew, and had written it down.
 *
 * ## What the guess got wrong
 *
 * Two things, and one of them reaches a person.
 *
 * It collapsed two endings into one. `iterations` and `runtime` are different
 * ceilings, and the result comment says "ran out of iterations" for both. This
 * runner passes `--max-runtime-secs` and no `--max-iterations`, so the ceiling it
 * hits is ALWAYS the clock — which makes that sentence always the wrong one.
 *
 * And it raced. The stop file is written by a watcher while the run is going; a run
 * that reached its time limit at the moment somebody typed `/stop` exits for the
 * clock and is reported as stopped, because by then the file is there.
 *
 * ## The fallback
 *
 * A session that cannot be read leaves the old guess in place, because there is
 * nothing better to say and `stop_requested` decides whether a person is told their
 * stop landed. It is the only place left that tests the file, and it is reached only
 * when the run failed to write the session it was told to write.
 *
 * Usage:
 *   read_run_ending.ts --session FILE --exit-code N [--stop-file FILE]
 * Writes `ended_because=<word>` to $GITHUB_OUTPUT.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { defineScript } from "./lib/script-ref.ts";

export interface ReadRunEndingArgs {
  session: string;
  "exit-code": string;
  "stop-file"?: string;
}

export const ref = defineScript<ReadRunEndingArgs>(import.meta.url);

/** The exit status the core uses for an ending somebody asked for, session written. */
const SOFT_STOP = "2";

/** What the core wrote about the run that just finished, if it wrote anything. */
export function endingFromSession(raw: string): string | undefined {
  let parsed: { atoma_runs?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return undefined;
  }
  const runs = parsed.atoma_runs;
  if (!Array.isArray(runs) || runs.length === 0) return undefined;
  const last = runs[runs.length - 1] as { ended_because?: unknown };
  return typeof last?.ended_because === "string" && last.ended_because !== "" ? last.ended_because : undefined;
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { session: { type: "string" }, "exit-code": { type: "string" }, "stop-file": { type: "string" } },
  });

  const exitCode = values["exit-code"] ?? "";
  const sessionPath = values.session ?? "";
  const recorded = existsSync(sessionPath) ? endingFromSession(readFileSync(sessionPath, "utf8")) : undefined;

  let ending: string;
  if (recorded !== undefined) {
    ending = recorded;
  } else if (exitCode === SOFT_STOP) {
    // The only remaining reader of the stop file, and only when the run did not
    // write the session it was told to write.
    const stopFile = values["stop-file"] ?? "";
    ending = stopFile !== "" && existsSync(stopFile) ? "stopped" : "runtime";
    console.error(`read_run_ending: no record in the session; guessing "${ending}" from the stop file`);
  } else {
    ending = exitCode === "0" ? "completed" : "failed";
    console.error(`read_run_ending: no record in the session; taking "${ending}" from exit ${exitCode || "(none)"}`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, `ended_because=${ending}\n`);
  console.error(`read_run_ending: ended_because=${ending}`);
}

if (import.meta.main) main();

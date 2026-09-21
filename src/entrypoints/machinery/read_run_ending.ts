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
 * ## And whether it left a report
 *
 * The same file answers a second question, so it is opened once and asked both.
 * `domain/work/turn.ts` had no word for a run that ran to an ordinary end and said
 * nothing — those landed on `finished` and were read as completed — and the fact it
 * needs is in the session: the last assistant message either carries text or carries
 * only tool calls. Nothing is asked of the agent; `reported` is read off the record.
 *
 * Usage:
 *   read_run_ending.ts --session FILE --exit-code N [--stop-file FILE]
 * Writes `ended_because=<word>` and `reported=<true|false>` to $GITHUB_OUTPUT.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Session, SessionMessage } from "../../domain/work/session.ts";
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

/**
 * The words in a message, whichever of the two shapes it is stored in.
 *
 * A message is plain text in nearly every case; the block form appears when a
 * picture travels with it. A picture is not a report, so only the text blocks count.
 */
function textOf(content: SessionMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/**
 * Whether the run left a report: did the last thing the model said have words in it?
 *
 * The LAST assistant message, not any of them. An earlier one is a sentence from the
 * middle of the work, and this repository has already measured what that is worth —
 * these agents write prose exactly once, in their final turn — so treating one as a
 * report would call a run reported that a person would call silent.
 *
 * The session accumulates across runs, and this does not take the boundary of the
 * current one. It does not need to: the only way the newest assistant message belongs
 * to an EARLIER run is for this one to have produced none at all, which means it was
 * cut short before its first turn — and `stopped`, `spent` and `failed` are all
 * decided above `no-report` in `endingOf`, so the answer given here is not the one
 * read. Adding the boundary would be a second argument that changes no decision.
 *
 * `false` for anything unreadable, on the same footing as the ending's fallback: a
 * run that did not write the session it was told to write is not one to record as
 * having reported.
 */
export function reportedInSession(raw: string): boolean {
  let parsed: Session;
  try {
    parsed = JSON.parse(raw) as Session;
  } catch {
    return false;
  }
  const messages = parsed.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return textOf(message.content).trim() !== "";
  }
  return false;
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { session: { type: "string" }, "exit-code": { type: "string" }, "stop-file": { type: "string" } },
  });

  const exitCode = values["exit-code"] ?? "";
  const sessionPath = values.session ?? "";
  // One read, two questions, so both facts about this run come from the same bytes.
  // A session runs to tens of megabytes on a long thread, and opening it twice also
  // leaves room for it to change between the two answers.
  const raw = existsSync(sessionPath) ? readFileSync(sessionPath, "utf8") : undefined;
  const recorded = raw === undefined ? undefined : endingFromSession(raw);
  const reported = raw !== undefined && reportedInSession(raw);

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
  if (githubOutput) appendFileSync(githubOutput, `ended_because=${ending}\nreported=${reported}\n`);
  console.error(`read_run_ending: ended_because=${ending} reported=${reported}`);
}

if (import.meta.main) main();

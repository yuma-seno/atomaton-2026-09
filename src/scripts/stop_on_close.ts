#!/usr/bin/env bun
/**
 * stop_on_close.ts — closing an issue an agent is working on asks that run to stop.
 *
 * ## Why closing has to mean something
 *
 * It already looked like it did. #803 was closed by hand while its run held the
 * in-progress label; the run kept going for five more minutes, opened a pull request,
 * and nothing anywhere said that closing had not stopped it. A gesture that reads as
 * "stop this" and does nothing is worse than no gesture, because the person walks
 * away believing it worked.
 *
 * ## Why a stop rather than a reopen
 *
 * Reopening would undo a decision a person just made, and the comment guard's reason
 * for deleting does not apply here: that guard prevents a second run from racing the
 * first, and closing starts no run. So the issue stays closed and the work stops —
 * which is what closing appeared to mean all along.
 *
 * ## Why only a person's close
 *
 * An agent closing the issue it is working on is a normal path, not an accident:
 * `domain/atomaton-data-pruning.ts` is built around it ("the agent closes it and the
 * job continues"). Stopping the run that just closed its own issue would cut it off
 * mid-wrap-up, so the caller passes the closer and a bot closer is no-op'd here.
 *
 * ## The mechanism is the existing one
 *
 * `/stop` is a comment carrying `STOP_TAG`, which the running job polls for — it has
 * to be a comment because nothing outside a job can reach into it. That works just as
 * well from an `issues: closed` workflow, so no second stop path exists.
 *
 * Usage:
 *   stop_on_close.ts --number N --closer LOGIN [--closer-type Bot|User]
 */
import { parseArgs } from "node:util";
import { gh } from "../lib/gh.ts";
import { getLabel } from "../lib/config.ts";
import { LLM_CONTEXT_TAG, STOP_TAG } from "../lib/tags.ts";
import { runningChildren } from "../lib/running-children.ts";
import { stopOnCloseNotice } from "../domain/closed-issue.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface StopOnCloseArgs {
  number: string | number;
  closer: string;
  "closer-type": string;
}

export const ref = defineScript<StopOnCloseArgs>(import.meta.url);

/**
 * The whole comment, tags included.
 *
 * `STOP_TAG` is what the running job reads; `LLM_CONTEXT_TAG` keeps this out of the
 * session, for the same reason `/stop`'s own notice is excluded — it is addressed to
 * a person, and an agent reading it would take it as something it was told.
 */
export function stopOnCloseBody(number: number, children: readonly number[]): string {
  const lines = [LLM_CONTEXT_TAG.write("exclude"), STOP_TAG.write("requested"), stopOnCloseNotice(number)];
  if (children.length > 0) {
    lines.push(
      "",
      `Work is also running on ${children.map((n) => `#${n}`).join(", ")}. ` +
        "Closing this issue does not reach those — comment `/stop` on each one you want stopped.",
    );
  }
  return lines.join("\n");
}

interface IssueForClose {
  labels?: { name?: string }[];
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      closer: { type: "string" },
      "closer-type": { type: "string" },
    },
  });

  if (!values.number) {
    console.error("usage: stop_on_close.ts --number N --closer LOGIN [--closer-type Bot|User]");
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const number = String(values.number);
  const closer = (values.closer ?? "").trim();

  if ((values["closer-type"] ?? "").trim() === "Bot") {
    console.error(`#${number} was closed by a bot, which is how an agent finishes its own work. Nothing to stop.`);
    return;
  }

  const { code, stdout, stderr } = gh("api", `repos/${repo}/issues/${number}`);
  // A failed lookup is not "no label". This decides whether a run is still going, and
  // the answer it could not determine must not be the one that stays quiet — the same
  // rule `guard_comment_during_run.ts` follows for the same reason.
  if (code !== 0) {
    console.error(`::error::Could not read #${number}, so this cannot tell whether a run is in progress: ${stderr || stdout}`);
    process.exit(1);
  }

  let issue: IssueForClose;
  try {
    issue = JSON.parse(stdout) as IssueForClose;
  } catch {
    console.error(`::error::Could not parse the response for #${number}.`);
    process.exit(1);
  }

  const label = getLabel("in_progress");
  const inProgress = (issue.labels ?? []).some((l) => l.name === label);
  if (!inProgress) {
    console.error(`#${number} carries no '${label}' label, so no run is working on it. Nothing to stop.`);
    return;
  }

  const children = runningChildren(repo, Number(number));

  const posted = gh(
    "issue", "comment", number, "--repo", repo,
    "--body", stopOnCloseBody(Number(number), children),
  );
  // Fatal, like `/stop`'s own request. This comment IS the stop: without it the run
  // polls, finds nothing, and keeps going — while the person who closed the issue has
  // every reason to believe it is winding down.
  if (posted.code !== 0) {
    console.error(`::error::Could not post the stop request on #${number}: ${posted.stderr || posted.stdout}`);
    process.exit(1);
  }

  console.error(
    `#${number} was closed by ${closer || "(unknown)"} while a run held '${label}'. Stop requested` +
      `${children.length ? `; children still running: ${children.join(", ")}` : ""}.`,
  );
}

if (import.meta.main) main();

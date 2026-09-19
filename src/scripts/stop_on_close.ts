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
import { LLM_CONTEXT_TAG, STOP_TAG } from "../lib/tags.ts";
import { closedTheTreeNotice, stopOnCloseNotice } from "../domain/closed-issue.ts";
import { descendants, nodesToClose, nodesToStop, subtree } from "../domain/work-tree.ts";
import { closeSubtreeUnder, readWorkTree } from "../lib/work-tree.ts";
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
export function stopOnCloseBody(
  number: number,
  closed: readonly number[],
  stopped: readonly number[],
): string {
  return [
    LLM_CONTEXT_TAG.write("exclude"),
    STOP_TAG.write("requested"),
    stopOnCloseNotice(number),
    closedTheTreeNotice(closed, stopped),
  ].join("\n");
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

  // Closing ends a line of work rather than one node, so the sub-issues and pull
  // requests under it go with it. See `domain/work-tree.ts`.
  //
  // The tree is read before anything is decided, and that ordering is the fix for what
  // this used to do: it read the root's label, found none, and returned — which is
  // right about the root and wrong about the work, because an issue can be closed with
  // nothing running on it and a live chain underneath.
  const root = Number(number);
  const { nodes, problems: readProblems } = readWorkTree(repo, root);
  // A failed read is not "nothing to do". The answer this could not determine must not
  // be the one that stays quiet — the rule `guard_comment_during_run.ts` follows, for
  // the same reason.
  if (nodes.length === 0) {
    console.error(`::error::Could not read the work under #${root}: ${readProblems.join("; ")}`);
    process.exit(1);
  }

  const all = subtree(nodes, root);
  const under = descendants(all, root);
  const toStop = nodesToStop(all);
  const toClose = nodesToClose(under);
  if (toStop.length === 0 && toClose.length === 0) {
    console.error(`Nothing is running under #${root} and nothing under it is open. Nothing to do.`);
    return;
  }

  const result = closeSubtreeUnder(
    repo,
    root,
    stopOnCloseBody(root, toClose.map((n) => n.number), nodesToStop(under).map((n) => n.number)),
  );
  result.problems.push(...readProblems);

  const rootFailed = result.problems.some((problem) => problem.includes(`#${root}`));
  for (const problem of result.problems) console.error(`::warning::${problem}`);
  // Fatal only when the root got nothing. That comment IS the stop: without it the run
  // polls, finds nothing, and keeps going — while the person who closed the issue has
  // every reason to believe it is winding down.
  if (rootFailed) process.exit(1);

  console.error(
    `#${root} was closed by ${closer || "(unknown)"}. ` +
      `Stopped: ${result.stopped.map((n) => `#${n}`).join(", ") || "none"}. ` +
      `Closed under it: ${result.closed.map((n) => `#${n}`).join(", ") || "none"}.`,
  );
}

if (import.meta.main) main();

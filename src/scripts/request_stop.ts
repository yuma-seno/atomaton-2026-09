#!/usr/bin/env bun
/**
 * request_stop.ts — Act on a `/stop` comment: remove it, and post the request the
 * running job polls for.
 *
 * ## Why the request is a comment
 *
 * Nothing outside a workflow job can reach into that job's filesystem, so a stop has
 * to be left somewhere both sides can see. A comment is that place, and it is also
 * the record of who asked and when — a label would have needed a second thing to
 * carry the same information.
 *
 * The running job polls for `STOP_TAG` and, when it finds one newer than its own
 * start, writes the file `atoma run --stop-file` is watching. See `watch_for_stop.ts`.
 *
 * ## Why the human's comment is deleted
 *
 * A stop must not become the next run's context. The whole point is that the run is
 * paused rather than told something; a `/stop` sitting in the session would be read
 * by the resumed agent as an instruction it has to account for.
 *
 * The notice this posts is tagged `llm-context=exclude`, so it is dropped by
 * `reconcile_github_session.ts` on the way into a session for the same reason.
 *
 * ## Why it says the comment was deleted
 *
 * Because the existing in-progress guard also deletes comments, and says so. Someone
 * whose `/stop` vanished with no explanation would have no way to tell "your stop is
 * being acted on" from "your comment was refused because a run is in progress".
 *
 * Usage:
 *   request_stop.ts --number N --comment-id ID --commenter LOGIN
 */
import { parseArgs } from "node:util";
import { gh } from "../lib/gh.ts";
import { LLM_CONTEXT_TAG, STOP_TAG } from "../lib/tags.ts";
import { descendants, nodesToStop, subtree } from "../domain/work/work-tree.ts";
import { readWorkTree, requestStopAcross } from "../lib/work-tree.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface RequestStopArgs {
  number: string | number;
  "comment-id": string | number;
  commenter: string;
}

export const ref = defineScript<RequestStopArgs>(import.meta.url);

/**
 * The receipt, as the person who typed `/stop` will read it.
 *
 * A receipt, and deliberately not a record. The run posts its own result comment
 * seconds later, and the two used to say the same thing twice and mention the same
 * person twice. So this says only what is true when it is posted: the command was
 * received, what became of the comment, and that the stop is not instant. Whether
 * the run stopped, whether the session survived, and that `/resume` works are the
 * run's to say — it is the one that does them.
 *
 * No mention either. A mention means "your turn", and the person who just typed
 * `/stop` has taken theirs; the turn comes back when the run reports, and that
 * comment mentions them. The login is still named, because whose comment was removed
 * is a fact worth recording — written without the `@`, which is what would turn a
 * record into a second notification.
 */
export function stopRequestedNotice(commenter: string, deleted: boolean, alsoReached: number[]): string {
  const whose = commenter ? `${commenter}'s` : "The";
  const lines = [
    LLM_CONTEXT_TAG.write("exclude"),
    STOP_TAG.write("requested"),
    "Atomaton: stop requested.",
    "",
    deleted
      ? `${whose} \`/stop\` comment was removed so it does not become part of the agent's context.`
      : `${whose} \`/stop\` comment could not be removed, so it may end up in the agent's context.`,
    "",
    // The lag is real and it is the thing people will misread. A stop is picked up on
    // the next poll and taken at the next turn, so the agent can finish a tool call
    // and start another one after the request. Without this line that reads as the
    // command having done nothing.
    "The run will stop after its current step, so it may take a minute, and it will report here when it has.",
  ];
  if (alsoReached.length > 0) {
    // Named rather than counted, so a person can see whether the stop went where they
    // meant it to. This used to be the opposite list — the work a stop could NOT
    // reach, with instructions to go and stop each piece by hand — which was the
    // machinery handing somebody a checklist because its own vocabulary was one node
    // wide. See `domain/work/work-tree.ts`.
    lines.push(
      "",
      `It also reached the work running on ${alsoReached.map((n) => `#${n}`).join(", ")}, ` +
        "which is under this issue. `/resume` here brings all of it back.",
    );
  }
  return lines.join("\n");
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      "comment-id": { type: "string" },
      commenter: { type: "string" },
    },
  });

  if (!values.number || !values["comment-id"]) {
    console.error("usage: request_stop.ts --number N --comment-id ID --commenter LOGIN");
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const number = String(values.number);

  const { code: delCode, stdout: delOut, stderr: delErr } = gh(
    "api", "--method", "DELETE", `repos/${repo}/issues/comments/${values["comment-id"]}`,
  );
  const deleted = delCode === 0;
  if (!deleted) {
    console.error(`Warning: failed to delete comment #${values["comment-id"]} on #${number}: ${delErr || delOut}`);
  }

  // The subtree, not this node. A person points at an issue and means the work under
  // it — `domain/work/work-tree.ts` has why stop and close differ in finality rather than
  // in reach.
  //
  // Read before posting, so the receipt can name what the stop actually reached rather
  // than what it could not.
  const root = Number(number);
  const { nodes } = readWorkTree(repo, root);
  const under = nodesToStop(descendants(subtree(nodes, root), root)).map((node) => node.number);

  const result = requestStopAcross(
    repo,
    root,
    stopRequestedNotice(values.commenter ?? "", deleted, under),
  );
  // Fatal only when the root got nothing. That comment IS the request: without it the
  // run polls, finds nothing, and keeps going, and the person is told a stop is coming
  // that never arrives. A descendant that could not be reached is a warning — the rest
  // of the stop stands, and failing the step would report that none of it happened.
  for (const problem of result.problems) console.error(`::warning::${problem}`);
  if (!result.rootNotified) process.exit(1);

  console.error(`Stop requested across #${root}: ${result.stopped.length ? result.stopped.map((n) => `#${n}`).join(", ") : "no run was holding anything"}`);
}

if (import.meta.main) main();

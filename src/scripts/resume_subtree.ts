#!/usr/bin/env bun
/**
 * resume_subtree.ts — bring back everything a stop held, not just the node it was
 * typed on.
 *
 * `/stop` reaches the work under the issue a person named, so `/resume` has to reach
 * the same work or the model is only half true: you would stop a chain with one
 * comment and restart it with one comment per node, which is the checklist this was
 * built to remove. See `domain/work-tree.ts`.
 *
 * ## What it does not need to remember
 *
 * Nothing. There is no record of what a particular stop covered, and there does not
 * have to be: a node is resumable when it is open, nothing is running on it, and its
 * last run ended on a stop. All three are readable from the tree and the thread, so
 * `/resume` asks the same question `/stop` asked rather than replaying an answer.
 *
 * ## The root is not started here
 *
 * The workflow already dispatches the node the comment was typed on, through
 * `resolve_resume_agent.ts` and the ordinary dispatch path. This starts the
 * descendants, so the two halves keep the one entry point each rather than one path
 * gaining a special case.
 *
 * Best-effort in every direction: a descendant that cannot be started is a warning.
 * The run the person asked for is already going, and failing this step would report
 * that none of it happened.
 *
 * Usage:
 *   resume_subtree.ts --number N [--notify LOGIN]
 */
import { parseArgs } from "node:util";
import { descendants, nodesToResume, resumeCandidates, subtree } from "../domain/work-tree.ts";
import { dispatchRunner } from "../lib/dispatch.ts";
import { lastEnding, readWorkTree } from "../lib/work-tree.ts";
import { mostRecentAgentOn } from "./resolve_resume_agent.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ResumeSubtreeArgs {
  number: string | number;
  notify: string;
}

export const ref = defineScript<ResumeSubtreeArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { number: { type: "string" }, notify: { type: "string" } },
  });

  if (!values.number) {
    console.error("usage: resume_subtree.ts --number N [--notify LOGIN]");
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const root = Number(values.number);
  const { nodes, problems } = readWorkTree(repo, root);
  for (const problem of problems) console.error(`::warning::${problem}`);
  if (nodes.length === 0) {
    console.error(`Could not read the work under #${root}; nothing beyond it was resumed.`);
    return;
  }

  // The endings come one node at a time, and only for the ones that could still be
  // resumed on structure alone. Asking every node in a large tree how its last run
  // ended would be a request per node for an answer most of them cannot use.
  const candidates = resumeCandidates(descendants(subtree(nodes, root), root));
  const stoppedLast = new Set(
    candidates.filter((node) => lastEnding(repo, node.number) === "stopped").map((node) => node.number),
  );
  const resumable = nodesToResume(candidates, stoppedLast);

  if (resumable.length === 0) {
    console.error(`Nothing under #${root} was waiting to be resumed.`);
    return;
  }

  const started: number[] = [];
  for (const node of resumable) {
    const agent = mostRecentAgentOn(repo, node.number);
    if (!agent) {
      console.error(`::warning::#${node.number} was stopped but nothing says which agent ran there; skipping.`);
      continue;
    }
    const outcome = dispatchRunner({
      context: `a resume on #${root} reached #${node.number}, which a stop had held`,
      agent,
      type: node.kind === "pull-request" ? "pr" : "issue",
      number: node.number,
      notify: (values.notify ?? "").trim(),
      repo,
    });
    if (outcome === "dispatched") started.push(node.number);
    else console.error(`::warning::could not resume ${agent} on #${node.number} (${outcome}).`);
  }

  console.error(
    started.length > 0
      ? `Resumed under #${root}: ${started.map((n) => `#${n}`).join(", ")}`
      : `Nothing under #${root} could be resumed.`,
  );
}

if (import.meta.main) main();

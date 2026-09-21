#!/usr/bin/env bun
/**
 * aggregate_sub_issues.ts — Called after a PR merges and its linked
 * sub-issue's orchestrator parent is known. If any sibling sub-issues are
 * still open, just posts a progress comment. Once all siblings are done,
 * aggregates their results into the orchestrator's session (stored on the
 * orphan `atomaton-data` branch) and re-dispatches the orchestrator.
 *
 * Thin CLI wrapper around lib/aggregation.ts's shared dispatch gate -- see that
 * module's doc comment for the other two callers of the same gate and for the
 * race between them.
 *
 * Usage:
 *   aggregate_sub_issues.ts --repo OWNER/REPO --parent N --closed-num N
 */
import { parseArgs } from "node:util";
import { gh } from "../lib/gh.ts";
import { defineScript } from "./lib/script-ref.ts";
import { describeGateResult, dispatchOrchestratorIfReady, needsAttention } from "../lib/aggregation.ts";
import { gatherSubResults, injectSummary } from "../lib/inject-sub-results.ts";
import type { Session } from "../domain/work/session.ts";
import { issueLinks } from "../lib/issue-links.ts";
import { restoreSession, saveSession, sessionTargetPath } from "./lib/atomaton-data.ts";

export interface AggregateSubIssuesArgs {
  repo: string;
  parent: string | number;
  "closed-num": string | number;
}

export const ref = defineScript<AggregateSubIssuesArgs>(import.meta.url);

/**
 * Every sub-issue linked to `parent`, open or closed.
 *
 * GitHub's own sub-issue links, which is where every other reader of this
 * relationship now looks. It used to search for `atomaton:parent=N in:body` and then
 * re-check each hit with `PARENT_TAG.read`, because GitHub's issue search tokenizes
 * and returned `atomaton:parent=50` for a query of `5` — a prefilter that needed a
 * predicate behind it, and before that predicate existed this collected every
 * sub-issue of a numeric range and fed their results into the wrong orchestrator's
 * session. A link has no such failure mode: it is an edge, not a string.
 *
 * Throws when the links could not be read. Aggregation injects these results into
 * the orchestrator's session, and an empty list read as "no sub-issues" would
 * re-invoke it with none of the work it is supposed to be summarising.
 */
function linkedSubIssues(repo: string, parent: number): number[] {
  const links = issueLinks(repo, parent);
  if (links.unavailable) {
    throw new Error(`could not list sub-issues of #${parent}: ${links.unavailable}`);
  }
  return links.children.map((child) => child.number);
}

/**
 * Injects every linked sub-issue's result into the orchestrator's persisted
 * session on the `atomaton-data` branch.
 *
 * Reads and writes through lib/atomaton-data.ts rather than driving git here. That
 * module's `saveSession` already owns the part that is easy to get wrong -- it
 * creates the branch if absent, holds the push-retry loop for the races that are
 * expected when sibling agents finish together, and does all of it in a
 * throwaway worktree so the job's own checkout is untouched. This function used
 * to reimplement that with `git checkout -B atomaton-data` in the main checkout
 * (and `git rm -rf .` on the branch-missing path), which worked only because
 * nothing in this job reads a file afterwards.
 */
function injectResultsIntoOrchestratorSession(repo: string, parent: number): void {
  const subIssues = linkedSubIssues(repo, parent);
  console.error(`Sub-issues of #${parent}: ${subIssues.join(", ") || "(none)"}`);

  const sessionPath = sessionTargetPath("issue", parent, "orchestrator");
  const existing = restoreSession(sessionPath);
  const session: Session = existing ? (JSON.parse(existing) as Session) : { messages: [] };

  // Composed here, where the I/O belongs: read what the sub-issues did, then
  // put it in the session. `injectSummary` is the half that decides where.
  const updated = injectSummary(session, gatherSubResults(repo, subIssues));
  const message = `atomaton: inject sub-issue results for parent #${parent}`;
  if (!saveSession(sessionPath, JSON.stringify(updated, null, 2), message)) {
    console.error(`::warning::Failed to save session to atomaton-data:${sessionPath} after all retries.`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      parent: { type: "string" },
      "closed-num": { type: "string" },
    },
  });
  const repo = values.repo;
  const parent = values.parent;
  const closedNum = values["closed-num"];
  if (!repo || !parent || !closedNum) {
    console.error("usage: aggregate_sub_issues.ts --repo OWNER/REPO --parent N --closed-num N");
    process.exit(2);
  }

  console.error(`PR merged (sub-issue #${closedNum}, parent #${parent}). Checking siblings...`);

  const result = await dispatchOrchestratorIfReady({
    repo,
    parent: Number(parent),
    closedNum: Number(closedNum),
    // We already KNOW this sub-issue's work is done (its PR just merged)
    // regardless of whether GitHub's live issue state reflects that yet
    // (native "Closes #N" auto-close is unreliable under the Actions
    // GITHUB_TOKEN) -- excluding it makes this check reliably correct on
    // its first (and normally only) run instead of depending on that timing.
    exclude: true,
    progressMessage: (remaining) => `Atomaton: Sub-task #${closedNum} completed. ${remaining} sub-task(s) still in progress.`,
    beforeDispatch: () => injectResultsIntoOrchestratorSession(repo, Number(parent)),
  });

  console.error(describeGateResult(result, Number(closedNum), Number(parent)));
  // A run that left work undone must not look green. `needsAttention` is true
  // only for the two outcomes nothing else will retry.
  if (needsAttention(result)) process.exit(1);
}

if (import.meta.main) void main();


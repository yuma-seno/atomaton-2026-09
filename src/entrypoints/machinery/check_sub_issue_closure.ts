#!/usr/bin/env bun
/**
 * check_sub_issue_closure.ts — Determine whether a just-closed issue is an
 * Atomaton sub-issue and, if so, whether it was already closed via a merged PR
 * (in which case atomaton-pr-merged.wac.ts already handled aggregation, and this
 * fallback path must skip to avoid dispatching the atomaton twice).
 *
 * ## Why it asks GitHub rather than reading the event
 *
 * It used to take the parent from the `<!-- atomaton:parent=N -->` tag in the closed
 * issue's body, which the webhook payload already carries — free, and wrong for the
 * same reason the tag is gone everywhere else: it recorded the parent at creation and
 * nothing rewrote it, so a sub-issue re-parented in the web UI aggregated under the
 * issue it used to be under. One request buys the answer the rest of the system uses.
 *
 * A parent that could not be READ is not a parent that is absent. Saying
 * `is_sub_issue=false` there would skip the aggregation silently, and nothing else
 * would notice a parent that is never re-invoked — so this fails instead.
 *
 * Env: CLOSED_NUM, OWNER, REPO
 * Writes to $GITHUB_OUTPUT: is_sub_issue, parent_number, closed_via_pr
 */
import { appendFileSync } from "node:fs";
import { ghGraphql } from "../../adapters/github/gh.ts";
import { parentIssueOf } from "../../adapters/github/parent-issue.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

function main(): void {
  const closedNum = process.env.CLOSED_NUM ?? "";
  const owner = process.env.OWNER ?? "";
  const repo = process.env.REPO ?? "";
  const githubOutput = process.env.GITHUB_OUTPUT;

  const found = parentIssueOf(`${owner}/${repo}`, Number(closedNum));
  if (!found.known) {
    console.error(
      `::error::Could not tell whether #${closedNum} is a sub-issue (${found.why}), so nothing was aggregated. ` +
        "Its parent will not be re-invoked until someone does it by hand.",
    );
    process.exit(1);
  }
  const parent = found.parent || undefined;

  if (parent === undefined) {
    if (githubOutput) appendFileSync(githubOutput, "is_sub_issue=false\n");
    return;
  }

  console.error(`Sub-issue #${closedNum} closed — parent #${parent}`);

  // atomaton-pr-merged.wac.ts (pull_request_target: closed) is the PRIMARY
  // aggregation path and already handles sub-issues auto-closed by a merged
  // PR's "Closes #N". This path is the fallback, and whether the two can both
  // fire for one completion turns on WHO performed the merge, because GitHub
  // suppresses the event cascade only for actions taken with GITHUB_TOKEN:
  //
  // - An agent merge (`github__merge_pr`, which the shipped `merge.policy:
  //   auto` permits) runs as GITHUB_TOKEN, so the auto-close fires no
  //   `issues: closed` event and this workflow never starts. The guard below
  //   costs nothing.
  // - A person merging from the GitHub UI — the only route under
  //   `merge.policy: manual`, and always available regardless — uses their
  //   own credentials, so the auto-close DOES fire this workflow while
  //   atomaton-pr-merged is already handling the same completion.
  //
  // The second case is why the check exists: without it the atomaton gets
  // dispatched twice. lib/aggregation.ts's `atomaton:aggregated` marker would
  // catch the duplicate anyway, but only after a second run has started.
  let closedViaPr = false;
  try {
    const data = ghGraphql<{
      repository: { issue: { closedByPullRequestsReferences: { nodes: { number: number }[] } } };
    }>(
      "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){closedByPullRequestsReferences(first: 1) { nodes { number } }}}}",
      { owner, repo, num: Number(closedNum) },
    );
    const mergedPr = data.repository.issue.closedByPullRequestsReferences.nodes[0]?.number;
    if (mergedPr) {
      console.error(`Closed via merged PR #${mergedPr} — already handled by atomaton-pr-merged.yml. Skipping.`);
      closedViaPr = true;
    }
  } catch {
    // best-effort; treat as not closed via PR
  }

  if (githubOutput) {
    appendFileSync(githubOutput, ["is_sub_issue=true", `parent_number=${parent}`, `closed_via_pr=${closedViaPr}`].join("\n") + "\n");
  }
}

if (import.meta.main) main();

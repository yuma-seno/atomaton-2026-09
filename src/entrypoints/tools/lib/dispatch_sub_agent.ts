import { gh } from "../../../adapters/github/gh.ts";
import { isAgentName } from "../../../domain/work/agent-name.ts";
import { getLabel } from "../../../adapters/runner/config.ts";
import { dispatchRunner } from "../../../adapters/actions/dispatch.ts";
import { LLM_CONTEXT_TAG } from "../../../adapters/github/tags.ts";

export interface DispatchSubAgentResult {
  issue: number;
  agent: string;
}

/**
 * Posts a dispatch-confirmation comment on the sub-issue, tags it as
 * "launched", and dispatches the runner workflow.
 */
export function dispatchSubAgent(issue: number, agent: string, notify = ""): DispatchSubAgentResult {
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error(`issue must be a positive integer, got: ${issue}`);
  }
  if (!isAgentName(agent)) {
    throw new Error(`agent must be a valid lowercase agent name, got: ${agent}`);
  }

  gh(
    "issue", "comment", String(issue),
    "--body", `${LLM_CONTEXT_TAG.write("exclude")}\nAtomaton: Agent \`${agent}\` dispatched to work on this sub-task.`,
  );

  const launchedLabel = getLabel("launched");
  // Create it first, as the in-progress and sub-issue labels already do. Adding a
  // label that does not exist fails, and the failure below is only a warning — but
  // `sibling-check.ts` reads this label to decide whether a sub-issue has already
  // been launched, so silently never applying it makes a child look unlaunched and
  // invites a relaunch.
  gh("label", "create", launchedLabel, "--force", "-c", "1f883d", "-d", "Atomaton has dispatched an agent for this sub-task");
  const { code: labelCode } = gh("issue", "edit", String(issue), "--add-label", launchedLabel);
  if (labelCode !== 0) {
    console.error(`Warning: failed to add '${launchedLabel}' label to #${issue}`);
  }

  // Throws rather than returning quietly: `launch_sub_agent` reports each task's
  // outcome to the atomaton individually, and the confirmation comment above
  // is already posted, so a swallowed failure would leave a sub-issue that says
  // an agent is working on it while nothing is.
  const outcome = dispatchRunner({
    context: `${agent} was to be started on sub-issue #${issue}`,
    agent,
    type: "issue",
    number: issue,
    notify,
  });
  if (outcome === "refused-closed") {
    // A sub-issue this run created a moment ago, already closed. Rare, and named
    // separately because "see the workflow log for the gh error" would send the
    // atomaton looking for a failure that did not happen.
    throw new Error(`#${issue} is not open, so ${agent} was not started on it; the issue says so.`);
  }
  if (outcome !== "dispatched") {
    throw new Error(`could not dispatch ${agent} on sub-issue #${issue}; see the workflow log for the gh error`);
  }

  return { issue, agent };
}
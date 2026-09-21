/**
 * dispatch.ts — start an agent run by dispatching the runner workflow.
 *
 * Four places hand work to another agent: an orchestrator launching sub-agents,
 * a created PR summoning its reviewer, a merged PR re-invoking the agent that
 * opened it, and the aggregation gate re-invoking an orchestrator once its
 * sub-issues are done. Each had built its own `gh workflow run` call, and the
 * copies had diverged in the two ways that matter.
 *
 * They disagreed on how the workflow is named -- `||`, `??`, a hardcoded
 * string, and a per-call option nothing ever passed.
 *
 * More seriously, two of them ignored the exit code and wrote the ops-log
 * dispatch entry unconditionally. That entry is not bookkeeping: it is the
 * signal `atomaton-runner`'s `chain_continues` output reads to decide whether work
 * is still in flight, and a hand-off keeps the `atomaton/in-progress`
 * label held whenever it is set. So a dispatch that failed -- a bad token, a
 * renamed workflow, a rate limit -- reported a chain that had started when none
 * had, and left the issue locked with nothing on the way to unlock it.
 *
 * Binding the two together here is the point of this module: the ops-log entry
 * is written if and only if GitHub accepted the dispatch, and it cannot be
 * forgotten by the next call site added.
 *
 * The same argument put the closed-target guard here. #803 was closed by hand while
 * its sub-issues were finishing, and eighteen seconds later the aggregation gate
 * dispatched an orchestrator onto it -- which ran for five minutes and opened a pull
 * request nobody was waiting for. None of the four call sites looked at the state of
 * the number it was dispatching onto, and a guard that each of them has to remember is
 * one the fifth will not have. See #827.
 */
import { dispatchWorkflow, gh } from "../../adapters/github/gh.ts";
import { logDispatch } from "../../adapters/runner/ops-log.ts";
import { readTargetState } from "../../adapters/github/target-state.ts";
import { dispatchRefusedNotice, mayStartWorkOn, type TargetState } from "../../domain/work/closed-issue.ts";

/** The reusable workflow every agent run enters through. */
function runnerWorkflow(): string {
  return process.env.ATOMATON_DISPATCH_WORKFLOW || "atomaton-runner.yml";
}

export interface RunnerDispatch {
  /**
   * Prefixes both log lines, so a failure names who was dispatching and why.
   * Carry the detail here -- "re-invoking engineer on #12 to confirm and close"
   * -- rather than leaving it to the generic message.
   */
  context: string;
  agent: string;
  type: "issue" | "pr";
  number: number | string;
  /** Omit or leave empty when there is nobody to mention; a silent run is normal. */
  notify?: string;
  /**
   * Pass when the caller's working directory is not a checkout of the target
   * repository. The MCP servers run inside one and so may omit it; a helper
   * called from an arbitrary job should not assume that.
   */
  repo?: string;
  /**
   * How many environment rebuilds this work has already had, for the run being
   * started to carry forward.
   *
   * Passed as a workflow input rather than counted from anywhere, because a reload
   * leaves nothing behind to count -- unlike a handoff, which leaves a comment
   * (see `domain/work/dispatch-chain.ts`). The tally has to travel with the dispatch or
   * it does not exist.
   *
   * Omitted by every other caller, which is correct: dispatching for any other
   * reason starts the count again, because the new run is not the result of a
   * rebuild.
   */
  reloadCount?: number;
  log?: (message: string) => void;
}

/**
 * What a dispatch did, as three answers rather than two.
 *
 * It used to be a boolean, and `false` already meant two things once this module
 * started refusing closed targets: GitHub rejected the call, or the target was in no
 * state to receive one. Only the first is a fault, only the second has a person
 * already being told, and a caller that cannot tell them apart reports the wrong one.
 * The same lesson `DispatchGateResult` in `aggregation.ts` was written down for.
 */
export type DispatchOutcome =
  /** GitHub accepted it and the ops-log entry is written. */
  | "dispatched"
  /** The target is closed, or its state could not be read. Nobody was dispatched, and the escalation is posted. */
  | "refused-closed"
  /** GitHub rejected the dispatch. Nothing is running and nothing will retry. */
  | "failed";

/**
 * Refuse to start an agent on a target that is not open, and say what will not happen.
 *
 * Here rather than at the four call sites, for the reason this module exists: each of
 * them built its own `gh workflow run` and the copies diverged. A guard that has to be
 * remembered is one the fifth caller will not have.
 *
 * The notice goes on the target itself, because that is where somebody looking for
 * this work will look, and a closed issue is still readable. `notify` carries whoever
 * asked for the run -- see `adapters/github/notify.ts`, which settles that question for every path
 * that starts one.
 */
function refuseClosedTarget(d: RunnerDispatch, state: TargetState): "refused-closed" {
  const log = d.log ?? ((message: string) => console.error(message));
  const body = dispatchRefusedNotice({
    agent: d.agent,
    number: Number(d.number),
    context: d.context,
    state,
    notify: d.notify ?? "",
  });
  const { code, stdout, stderr } = gh(
    "issue", "comment", String(d.number), ...(d.repo ? ["--repo", d.repo] : []), "--body", body,
  );
  // A warning rather than a throw: the refusal stands either way, and the caller has
  // its own way of reporting. What is lost is the person being told, which is worth a
  // line in the log that says so rather than an exception that hides the refusal.
  if (code !== 0) {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open), and could not post the notice: ${stderr || stdout}`);
  } else {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open); notice posted`);
  }
  return "refused-closed";
}

/**
 * Dispatch the runner, unless the target is not open.
 *
 * Callers that have a fallback (closing an issue directly rather than asking an agent
 * to) branch on the outcome; callers that do not should at least not treat anything
 * but `"dispatched"` as success.
 */
export function dispatchRunner(d: RunnerDispatch): DispatchOutcome {
  const state = readTargetState(d.number, d.repo);
  if (!mayStartWorkOn(state)) return refuseClosedTarget(d, state);

  const args = [
    ...(d.repo ? ["--repo", d.repo] : []),
    "--field", `agent=${d.agent}`,
    "--field", `number=${d.number}`,
    "--field", `type=${d.type}`,
    "--field", `notify=${d.notify ?? ""}`,
    // Always sent, so the input has a value on every path rather than defaulting in
    // one place and being absent in another.
    "--field", `reload_count=${d.reloadCount ?? 0}`,
  ];
  if (!dispatchWorkflow(d.context, runnerWorkflow(), args, d.log)) return "failed";
  logDispatch(d.type, d.agent, { number: Number(d.number) });
  return "dispatched";
}

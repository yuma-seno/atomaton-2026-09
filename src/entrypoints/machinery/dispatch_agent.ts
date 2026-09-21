#!/usr/bin/env bun
/**
 * dispatch_agent.ts — hand work to the next agent, from a workflow step.
 *
 * A workflow step that needs to start an agent used to write its own `gh workflow
 * run atomaton-runner.yml` in bash. Two did — the runner's hand-off to the agent a
 * directive named, and the validation workflow's hand-off to whoever the result
 * called for — and both were invisible to `adapters/actions/dispatch.ts`, which exists to make
 * exactly that impossible. Its header says so:
 *
 * > a guard that each of them has to remember is one the fifth will not have.
 *
 * Those two were the fifth and the sixth. Neither refused a closed target (#827: an
 * orchestrator dispatched onto an issue closed eighteen seconds earlier, ran for five
 * minutes and opened a pull request nobody was waiting for), neither wrote the
 * ops-log dispatch entry that `chain_continues` and `shouldReleaseGuard` read, and
 * neither sent `reload_count`, which `dispatchRunner` documents as "always sent, so
 * the input has a value on every path". A workflow step cannot import TypeScript, so
 * this script is how it reaches the one dispatcher.
 *
 * ## What each exit code means
 *
 * - `0` — the run was dispatched, or it was refused because the target is not open.
 *   A refusal is not a fault: nothing is running, and the person who asked has
 *   already been told on the target itself. Failing the step here would report the
 *   refusal as a broken workflow.
 * - `1` — GitHub rejected the dispatch, or the arguments were not usable. Nothing is
 *   running and nothing will retry, which is worth failing the job over.
 *
 * Usage:
 *   dispatch_agent.ts --agent reviewer --number 12 --type pr \
 *     --context "CI passed on #12, so reviewer was to review it"
 */
import { parseArgs } from "node:util";
import { isAgentName } from "../../domain/work/agent-name.ts";
import { dispatchRunner } from "../../adapters/actions/dispatch.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface DispatchAgentArgs {
  /** The agent to start. Validated here, because it usually comes from another agent's output. */
  agent: string;
  /** The issue or pull request number to start it on. */
  number: string | number;
  /** `issue` or `pr`. */
  type: string;
  /** Who to mention; empty when nobody asked for this run. */
  notify?: string;
  /** `owner/name`, when the step's checkout is not the target repository. */
  repo?: string;
  /**
   * What was about to happen, in the caller's words.
   *
   * Not decoration: it is the sentence a person reads in the refusal notice when the
   * target turns out to be closed (`dispatchRefusedNotice`), and the prefix on both
   * log lines. Written at the call site because only the call site knows why.
   */
  context: string;
}

export const ref = defineScript<DispatchAgentArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      agent: { type: "string" },
      number: { type: "string" },
      type: { type: "string" },
      notify: { type: "string" },
      repo: { type: "string" },
      context: { type: "string" },
    },
  });

  const agent = (values.agent ?? "").trim();
  const number = Number((values.number ?? "").trim());
  const type = (values.type ?? "").trim();
  const context = (values.context ?? "").trim();

  // Checked here rather than in the step's bash, where it was a copy of
  // `AGENT_NAME_PATTERN` spliced into a regex. A name that is not one cannot start a
  // run, and saying which of the three is wrong is cheaper than a dispatch that
  // fails at GitHub with "workflow not found".
  if (!isAgentName(agent)) {
    console.error(`::error::dispatch_agent: '${agent}' is not an agent name, so nothing was dispatched.`);
    process.exit(1);
  }
  if (type !== "issue" && type !== "pr") {
    console.error(`::error::dispatch_agent: --type must be 'issue' or 'pr', not '${type}'.`);
    process.exit(1);
  }
  if (!Number.isInteger(number) || number <= 0) {
    console.error(`::error::dispatch_agent: --number must be a positive number, not '${values.number ?? ""}'.`);
    process.exit(1);
  }
  if (!context) {
    console.error("::error::dispatch_agent: --context is required; it is what a person reads if this is refused.");
    process.exit(1);
  }

  const outcome = dispatchRunner({
    context,
    agent,
    type,
    number,
    notify: values.notify ?? "",
    repo: (values.repo ?? "").trim() || undefined,
  });

  if (outcome === "failed") {
    console.error(`::error::Could not dispatch ${agent} on ${type} #${number}.`);
    process.exit(1);
  }
}

if (import.meta.main) main();

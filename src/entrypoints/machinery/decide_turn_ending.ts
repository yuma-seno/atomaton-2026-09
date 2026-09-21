#!/usr/bin/env bun
/**
 * decide_turn_ending.ts — reads the signals a finished run left behind into the one
 * name for how the turn ended, and publishes what each following step needs of it.
 *
 * Three outputs, and each is exactly one step's condition:
 *
 *   should_release   the at-most-one-turn guard comes off this node
 *   dispatch_to      the agent to start now, or empty
 *   chain_over_to    the agent that WOULD have started, but the chain's limit
 *                    stopped it, or empty
 *
 * They are published rather than derived in the workflow because the workflow is
 * where the previous version of `dispatch_to` lived — `DISPATCH_NEXT_GUARD`, a
 * four-term Actions expression thirty lines below the step that asked the domain
 * the neighbouring question. `docs/operations.md` forbids that shape, and it sat
 * beside the paragraph forbidding it. See `domain/work/turn.ts`.
 *
 * ## Why it must not fail
 *
 * This runs under `if: always()`, and `should_release` decides whether a lock comes
 * off. Exiting before writing it would leave the "Remove label" step's condition
 * evaluating against an empty output — false — and the label stuck FOREVER, with no
 * error surfaced anywhere.
 *
 * So a missing, empty or unrecognised `--outcome` is not an error here. It is
 * treated as any other non-success outcome: `succeeded` becomes false, the turn
 * `failed`, and the guard is released. That is also what the inline bash it
 * replaced (`steps.atoma.outcome != 'success'`) did with an empty string. Fail
 * toward releasing the guard, never toward holding it stuck.
 *
 * `--outcome` carries GitHub Actions' own `steps.atoma.outcome` value directly:
 * "success" | "failure" | "cancelled" | "skipped".
 *
 * Usage:
 *   decide_turn_ending.ts --outcome success
 *     [--ended-because runtime] [--loop-limit-reached true]
 *     [--chain-continues true] [--directive AGENT_NAME]
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { endingOf, nextToDispatch, refusedByChainLimit, shouldReleaseGuard } from "../../domain/work/turn.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface DecideTurnEndingArgs {
  outcome: string;
  "ended-because"?: string;
  "loop-limit-reached"?: string;
  "chain-continues"?: string;
  directive?: string;
}

export const ref = defineScript<DecideTurnEndingArgs>(import.meta.url);

function isTrue(v: string | undefined): boolean {
  return v === "true";
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      outcome: { type: "string" },
      "ended-because": { type: "string" },
      "loop-limit-reached": { type: "string" },
      "chain-continues": { type: "string" },
      directive: { type: "string" },
    },
  });
  if (!values.outcome) {
    console.error("decide_turn_ending: --outcome missing/empty -- treating as a failed turn (releases the guard)");
  }

  const ending = endingOf({
    succeeded: values.outcome === "success",
    endedBecause: values["ended-because"] ?? "",
    loopLimitReached: isTrue(values["loop-limit-reached"]),
    chainContinues: isTrue(values["chain-continues"]),
    directive: values.directive ?? "",
  });

  const published = {
    ended: ending.ended,
    should_release: String(shouldReleaseGuard(ending)),
    dispatch_to: nextToDispatch(ending)?.agent ?? "",
    chain_over_to: refusedByChainLimit(ending)?.agent ?? "",
  };

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    for (const [key, value] of Object.entries(published)) appendFileSync(githubOutput, `${key}=${value}\n`);
  }
  console.error(
    `decide_turn_ending: outcome=${values.outcome ?? "(missing)"} -> ` +
      Object.entries(published).map(([key, value]) => `${key}=${value || "(none)"}`).join(" "),
  );
}

if (import.meta.main) main();

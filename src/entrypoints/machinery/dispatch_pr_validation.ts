#!/usr/bin/env bun
/**
 * dispatch_pr_validation.ts — hand a pull request to validation, from a workflow step.
 *
 * ## Why a person's command goes through validation rather than straight to the agent
 *
 * A person commenting `/<agent>` on a pull request is asking for a run, and the run
 * they are asking for is a judgement about a commit. Starting it immediately means
 * it reads a CI result that does not exist yet -- so it either waits with nothing
 * able to wake it, or reviews a commit whose checks have not run. Validation is the
 * thing that runs CI and waits, and it already dispatches whoever the result calls
 * for.
 *
 * So every agent start on a pull request goes through it, whoever asked: an agent's
 * handoff, a person's comment, and the re-validation after a push. One path, one
 * place that knows how to wait.
 *
 * ## What `asked-by-person` changes
 *
 * Who a FAILED check goes back to. An agent that broke its own pull request fixes
 * it; a person who asked for a run is owed the answer themselves, and handing their
 * request to an agent would be the machinery deciding on their behalf. See
 * `ValidationInput.askedByPerson`.
 *
 * Usage:
 *   dispatch_pr_validation.ts --repo OWNER/REPO --number N --branch B [--asked-by-person]
 */
import { parseArgs } from "node:util";
import { dispatchPrValidation } from "../../adapters/actions/dispatch-targets.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface DispatchPrValidationArgs {
  repo: string;
  number: string | number;
  branch: string;
  "asked-by-person"?: string;
}

export const ref = defineScript<DispatchPrValidationArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      branch: { type: "string" },
      "asked-by-person": { type: "string" },
    },
  });

  const repo = values.repo ?? "";
  const number = values.number ?? "";
  const branch = values.branch ?? "";
  if (!repo || !number || !branch) {
    console.error("usage: dispatch_pr_validation.ts --repo OWNER/REPO --number N --branch B");
    process.exit(2);
  }

  // `dispatchPrValidation` reads the agent names from the pull request itself, so
  // there is nothing to pass but the target. `asked-by-person` travels as a
  // workflow input because it is a fact about THIS request rather than about the
  // pull request -- the same pull request can be validated by an agent's push and
  // by a person's comment, and the two route a failure differently.
  const dispatched = dispatchPrValidation(repo, Number(number), branch, {
    askedByPerson: (values["asked-by-person"] ?? "") === "true",
  });
  if (!dispatched) {
    // Fatal, unlike most dispatches. The person asked for a run and nothing was
    // started; saying so in the log is the only place left, because the comment
    // that would carry it is the one this step was going to post.
    console.error(`::error::could not dispatch validation for PR #${number}; no agent will run`);
    process.exit(1);
  }
  console.error(`dispatched validation for PR #${number}`);
}

if (import.meta.main) main();

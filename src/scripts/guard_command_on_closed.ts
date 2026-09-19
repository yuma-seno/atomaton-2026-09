#!/usr/bin/env bun
/**
 * guard_command_on_closed.ts — a slash command on a closed issue or pull request does
 * not start an agent.
 *
 * Starting work on something somebody has closed is the machinery disagreeing with a
 * decision rather than acting on one, and until now it did that quietly: `/engineer`
 * on a closed issue dispatched a run exactly as it would on an open one.
 *
 * ## Why the comment is left alone
 *
 * `guard_comment_during_run.ts` deletes the comment it catches, because that comment
 * would otherwise race a running agent and end up in its context. Nothing is running
 * here and nothing is racing, so deleting somebody's words would cost something and
 * buy nothing. The command does not run; the comment stays.
 *
 * ## Why `/stop` is exempt
 *
 * An agent can close the issue it is working on and keep going — that is a normal
 * path — so a closed issue can still have a run on it. Refusing `/stop` there would
 * take away the only way to stop that run, which is the one moment the command exists
 * for. The in-progress guard carves out the same exception for the same reason.
 *
 * Usage:
 *   guard_command_on_closed.ts --number N --commenter LOGIN --command /engineer
 * Writes `blocked=true|false` to $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh } from "../lib/gh.ts";
import { LLM_CONTEXT_TAG } from "../lib/tags.ts";
import { readTargetState } from "../lib/target-state.ts";
import { commandOnClosedNotice, mayStartWorkOn } from "../domain/closed-issue.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface GuardCommandOnClosedArgs {
  number: string | number;
  commenter: string;
  command: string;
}

export const ref = defineScript<GuardCommandOnClosedArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      number: { type: "string" },
      commenter: { type: "string" },
      command: { type: "string" },
    },
  });

  if (!values.number) {
    console.error("usage: guard_command_on_closed.ts --number N --commenter LOGIN --command /agent");
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const number = Number(values.number);
  const command = (values.command ?? "").trim() || "the command";
  const githubOutput = process.env.GITHUB_OUTPUT;
  const say = (blocked: boolean) => {
    if (githubOutput) appendFileSync(githubOutput, `blocked=${blocked}\n`);
  };

  const state = readTargetState(number, repo);
  if (mayStartWorkOn(state)) {
    say(false);
    return;
  }

  // Tagged out of the model's context like every other notice addressed to a person.
  // A run may still be going on a closed issue — an agent can close its own — and an
  // untagged copy would be read by that agent as an instruction, when what it says is
  // that somebody else's command was refused.
  const posted = gh(
    "issue", "comment", String(number), "--repo", repo,
    "--body", [LLM_CONTEXT_TAG.write("exclude"), commandOnClosedNotice(values.commenter ?? "", command, state, number)].join("\n"),
  );
  if (posted.code !== 0) {
    console.error(`Warning: could not post the refusal on #${number}: ${posted.stderr || posted.stdout}`);
  }

  say(true);
  console.error(
    `Refused '${command}' on #${number}: ${state.kind === "unknown" ? `state unreadable (${state.why})` : "not open"}.`,
  );
}

if (import.meta.main) main();

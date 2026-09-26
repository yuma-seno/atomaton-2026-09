#!/usr/bin/env bun
/**
 * notify_unattended.ts — tell a person that a pull request's validation finished
 * and nobody was dispatched.
 *
 * ## Why this is a step of its own
 *
 * The validation writes a check run and, when it can, dispatches an agent. When it
 * cannot, the check is still written and the work simply waits -- and a pull
 * request that waits unannounced is the failure this exists to prevent. It is the
 * same failure `unattendedNotice` covers at creation time, one round later: the
 * pull request was attended when it was opened, and the agent it named is not
 * coming because CI failed and the request came from a person.
 *
 * ## Who is told
 *
 * `resolveNotify`, which is the person who asked for the run -- the commenter for a
 * comment, the opener for an issue, and the repository owner as a last resort. It
 * is the same resolution every other notice uses, so a person who is told about a
 * failure here is the person who was told about the run starting.
 *
 * Usage:
 *   notify_unattended.ts --repo OWNER/REPO --number N --summary "..."
 */
import { parseArgs } from "node:util";
import { gh } from "../../adapters/github/gh.ts";
import { resolveNotify } from "../../adapters/github/notify.ts";
import { LLM_CONTEXT_TAG } from "../../adapters/github/tags.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface NotifyUnattendedArgs {
  repo: string;
  number: string | number;
  summary: string;
}

export const ref = defineScript<NotifyUnattendedArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      summary: { type: "string" },
    },
  });

  const repo = values.repo ?? "";
  const number = values.number ?? "";
  if (!repo || !number) {
    console.error("usage: notify_unattended.ts --repo OWNER/REPO --number N --summary \"...\"");
    process.exit(2);
  }

  const notify = resolveNotify(repo, Number(number));
  const mention = notify ? `@${notify} ` : "";
  const summary = (values.summary ?? "").trim();

  // Tagged `include`, deliberately. This is a fact about the pull request -- that
  // its validation finished and nobody is coming -- and a later agent reading the
  // thread should see it. The bookkeeping comments are the ones that are excluded.
  const body = [
    LLM_CONTEXT_TAG.write("include"),
    `${mention}Atomaton: validation of this pull request finished and no agent was dispatched.`,
    ...(summary ? ["", summary] : []),
    "",
    "Comment `/<agent>` on this pull request to start one, or merge it yourself.",
  ].join("\n");

  const posted = gh("pr", "comment", String(number), "--repo", repo, "--body", body);
  if (posted.code) {
    console.error(`::warning::could not post the unattended notice on #${number}: ${posted.stderr.trim()}`);
  }
}

if (import.meta.main) main();

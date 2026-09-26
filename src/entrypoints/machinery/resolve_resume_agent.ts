#!/usr/bin/env bun
/**
 * resolve_resume_agent.ts — Decide which agent `/resume` means.
 *
 * `/resume` is `/<agent>` with the name filled in from what actually ran here, so a
 * person who wants to continue does not have to remember whether it was the engineer
 * or the reviewer. That is the only thing it does differently, which is why it takes
 * no instruction: `/<agent>` already resumes the same session AND carries one.
 *
 * The name is read from the thread rather than stored anywhere, the same choice
 * `dispatch-chain.ts` makes about handoffs. Every result comment already carries
 * `AGENT_TAG` -- `post_result_comment.ts` writes it so a later run can recognise its
 * own past output -- so the most recent one is the answer, and there is nothing extra
 * to keep in sync.
 *
 * Writes `agent` to $GITHUB_OUTPUT, empty when there is nothing to resume.
 *
 * Usage:
 *   resolve_resume_agent.ts --number N
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh } from "../../adapters/github/gh.ts";
import { LLM_CONTEXT_TAG } from "../../adapters/github/tags.ts";
import { mostRecentAgent, mostRecentAgentOn } from "../../adapters/github/agent-on-issue.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ResolveResumeAgentArgs {
  number: string | number;
}

export const ref = defineScript<ResolveResumeAgentArgs>(import.meta.url);

// `mostRecentAgent` and `mostRecentAgentOn` were defined here and are now in
// `adapters/github/agent-on-issue.ts`. The aggregation gate needed the same
// question answered -- "who was working on this node" -- and `app/` may not import
// from `entrypoints/`, so the reader moved to the layer both can reach. Re-exported
// because this module's own tests and `resume_subtree.ts` import them from here.
export { mostRecentAgent, mostRecentAgentOn };

function main(): void {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { number: { type: "string" } } });
  if (!values.number) {
    console.error("usage: resolve_resume_agent.ts --number N");
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const { code, stdout, stderr } = gh(
    "api", `repos/${repo}/issues/${values.number}/comments`, "--paginate", "--jq", "[.[].body]",
  );

  let agent = "";
  if (code === 0) {
    try {
      agent = mostRecentAgent(JSON.parse(stdout || "[]") as string[]);
    } catch {
      agent = "";
    }
  } else {
    console.error(`Could not read comments on #${values.number}: ${stderr || stdout}`);
  }

  if (!agent) {
    // Said on the issue, not only in the log. `/resume` produces no run when it
    // resolves to nothing, and a command that silently does nothing is
    // indistinguishable from a broken workflow.
    gh(
      "issue", "comment", String(values.number), "--repo", repo,
      "--body",
      [
        LLM_CONTEXT_TAG.write("exclude"),
        "Atomaton: `/resume` found no previous run on this issue to continue. Use `/<agent>` to start one.",
      ].join("\n"),
    );
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, `agent=${agent}\n`);
  console.error(agent ? `Resuming ${agent}` : "Nothing to resume");
}

if (import.meta.main) main();

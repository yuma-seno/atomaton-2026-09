#!/usr/bin/env bun
/**
 * resolve_pr_next_agent.ts — who a pull request asks to work on it next.
 *
 * ## Why the pull request's body, and not a dispatch argument
 *
 * A name passed to a dispatch is gone the moment that run ends. A pull request is
 * validated more than once -- the first push, a fix after a failed check, a person
 * asking for another look -- and every one of those needs the same answer. The body
 * is the only place that survives all of them, and it is where a person's own
 * `/<agent>` comment would go anyway.
 *
 * So an agent naming a reviewer and a person typing `/reviewer` are one mechanism:
 * both write a line, and this reads it.
 *
 * ## What it reads
 *
 * The first line that is a bare `/<agent>` naming a definition that exists, using
 * the same reader an agent's handoff goes through (`extract_directive.ts`). The
 * definition check is what keeps a body that mentions `/engineer` in prose from
 * dispatching anybody -- and a name with no definition would fail at
 * `gh workflow run`, which is the moment there is nowhere left to report it.
 *
 * ## What it does not read
 *
 * The `atomaton:origin-agent` tag, which is a different question: that is who
 * OPENED the pull request, and it is what a failed check goes back to. This is who
 * the pull request asks to look at it, and it is what a passing check goes to.
 *
 * Usage:
 *   resolve_pr_next_agent.ts --repo OWNER/REPO --number N --def-dir DIR
 * Writes `agent=<name-or-empty>` to $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh } from "../../adapters/github/gh.ts";
import { extractDirective } from "./extract_directive.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ResolvePrNextAgentArgs {
  repo: string;
  number: string | number;
  "def-dir": string;
}

export const ref = defineScript<ResolvePrNextAgentArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      "def-dir": { type: "string" },
    },
  });

  const repo = values.repo ?? "";
  const number = values.number ?? "";
  const defDir = values["def-dir"] ?? "";
  if (!repo || !number || !defDir) {
    console.error("usage: resolve_pr_next_agent.ts --repo OWNER/REPO --number N --def-dir DIR");
    process.exit(2);
  }

  // The body, and only the body. A comment could name an agent too, but a comment
  // is a moment and the body is the pull request's own statement of what it wants --
  // and a person's comment is handled by the comment workflow, which knows who
  // typed it and can tell a request from a remark.
  const { code, stdout, stderr } = gh("api", `repos/${repo}/pulls/${number}`, "--jq", ".body");
  if (code !== 0) {
    // Empty rather than fatal. A body that could not be read is the same answer as
    // one that names nobody: the pull request is left for a person, and the caller
    // says so on the pull request itself. Failing here would lose the CI result
    // that was already computed.
    console.error(`::warning::could not read the body of PR #${number}: ${stderr.trim() || `gh exited ${code}`}`);
  }

  const agent = extractDirective(stdout ?? "", defDir);
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, `agent=${agent}\n`);
  console.error(`PR #${number} asks for: ${agent || "(nobody)"}`);
}

if (import.meta.main) main();

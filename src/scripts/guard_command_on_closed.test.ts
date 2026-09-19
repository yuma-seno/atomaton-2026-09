import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { makeConfigDir, parseGithubOutput, runWithFakeGh, scriptPath } from "./testing/harness.ts";

describe("guard_command_on_closed.ts", () => {
  function run(state: { stdout?: string; code?: number }, args: string[] = []) {
    const configDir = makeConfigDir({});
    const outDir = mkdtempSync(join(tmpdir(), "atomaton-closed-guard-"));
    const outPath = join(outDir, "github-output");
    writeFileSync(outPath, "");
    try {
      const r = runWithFakeGh(
        scriptPath("guard_command_on_closed.ts"),
        ["--number", "803", "--commenter", "octocat", "--command", "/engineer", ...args],
        {
          cwd: configDir,
          env: { GITHUB_REPOSITORY: "owner/repo", GITHUB_OUTPUT: outPath },
          rules: [{ match: ["api", "issues/803"], ...state }, { match: ["issue", "comment"] }],
        },
      );
      return { ...r, outputs: parseGithubOutput(readFileSync(outPath, "utf8")) };
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  test("an open issue takes its command, and hears nothing about it", () => {
    const r = run({ stdout: JSON.stringify({ state: "open" }) });
    expect(r.status).toBe(0);
    expect(r.outputs.blocked).toBe("false");
    expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
  });

  test("a closed issue refuses, and says how to run it", () => {
    const r = run({ stdout: JSON.stringify({ state: "closed" }) });
    expect(r.status).toBe(0);
    expect(r.outputs.blocked).toBe("true");
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    expect(comment).toContain("@octocat");
    expect(comment).toContain("Reopen #803");
  });

  /**
   * GitHub cannot reopen a merged pull request, so the advice every other closed
   * target gets is advice this one cannot take.
   */
  test("a merged pull request is not told to reopen", () => {
    const r = run({ stdout: JSON.stringify({ state: "closed", pull_request: { merged_at: "2026-09-19T10:15:06Z" } }) });
    expect(r.outputs.blocked).toBe("true");
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    expect(comment).toContain("Open an issue");
    expect(comment).not.toContain("Reopen");
  });

  /**
   * The permissive answer is the one that starts an agent on something somebody
   * closed, so an unreadable state does not get it.
   */
  test("a state it could not read refuses rather than dispatching", () => {
    const r = run({ code: 1, stdout: "gh: not found" });
    expect(r.outputs.blocked).toBe("true");
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    expect(comment).toContain("could not be read");
  });

  /**
   * The notice is addressed to a person, and a run can still be going on a closed
   * issue -- an agent can close its own. Untagged, that agent reads somebody else's
   * refusal as something it was told.
   */
  test("the refusal is kept out of the agent's context", () => {
    const r = run({ stdout: JSON.stringify({ state: "closed" }) });
    expect(r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "").toContain("atomaton:llm-context=exclude");
  });
});

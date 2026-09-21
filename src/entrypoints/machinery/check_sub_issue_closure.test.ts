import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubOutput, runWithFakeGh, scriptPath } from "./testing/harness.ts";

/**
 * Two GraphQL calls now, told apart by what they ask for: the parent comes from
 * GitHub's own sub-issue link (the `atomaton:parent` tag it used to read out of the
 * webhook payload is gone — see `adapters/github/parent-issue.ts`), and the second asks whether a
 * merged pull request already closed it.
 */
const parentIs = (parent: number | null) => ({
  match: ["graphql", "parent{number}"],
  stdout: JSON.stringify({ data: { repository: { issue: { parent: parent === null ? null : { number: parent } } } } }),
});

const closedByPr = (pr: number | null) => ({
  match: ["graphql", "closedByPullRequestsReferences"],
  stdout: JSON.stringify({
    data: { repository: { issue: { closedByPullRequestsReferences: { nodes: pr === null ? [] : [{ number: pr }] } } } },
  }),
});

function run(rules: { match: string[]; stdout?: string; code?: number }[]) {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-test-"));
  try {
    const outputFile = join(dir, "out");
    writeFileSync(outputFile, "");
    const result = runWithFakeGh(scriptPath("check_sub_issue_closure.ts"), [], {
      env: { GITHUB_OUTPUT: outputFile, CLOSED_NUM: "9", OWNER: "owner", REPO: "repo" },
      rules,
    });
    return { ...result, out: parseGithubOutput(readFileSync(outputFile, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check_sub_issue_closure.ts", () => {
  test("detects a sub-issue and reports closed_via_pr=false when not closed via PR", () => {
    const { out } = run([parentIs(3), closedByPr(null)]);
    expect(out.is_sub_issue).toBe("true");
    expect(out.parent_number).toBe("3");
    expect(out.closed_via_pr).toBe("false");
  });

  test("reports closed_via_pr=true when the sub-issue was already closed by a merged PR", () => {
    const { out } = run([parentIs(3), closedByPr(12)]);
    expect(out.closed_via_pr).toBe("true");
  });

  test("reports is_sub_issue=false when GitHub says the issue has no parent", () => {
    const { out } = run([parentIs(null)]);
    expect(out.is_sub_issue).toBe("false");
  });

  /**
   * The distinction the old version could not make. It read the parent out of the
   * webhook payload, so "no tag" and "could not look" were the same answer — and the
   * quiet one skipped the aggregation, leaving an orchestrator nothing would ever
   * re-invoke.
   */
  test("a parent that could not be read fails rather than passing as 'not a sub-issue'", () => {
    const { status, stderr, out } = run([{ match: ["graphql", "parent{number}"], code: 1, stdout: "boom" }]);
    expect(status).toBe(1);
    expect(stderr).toContain("::error::");
    expect(out.is_sub_issue).toBeUndefined();
  });
});

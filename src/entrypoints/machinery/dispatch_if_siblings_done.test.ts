import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { makeConfigDir, runWithFakeGh, scriptPath, type FakeGhRule } from "./testing/harness.ts";

/**
 * The sub-issue links, which is where siblings come from now. `atomaton:parent=N
 * in:body` and the tag behind it are gone -- see `adapters/github/parent-issue.ts`.
 */
const subIssues = (...numbers: number[]): FakeGhRule => ({
  match: ["graphql"],
  stdout: JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          __typename: "Issue",
          subIssues: {
            nodes: numbers.map((number) => ({
              number,
              title: `#`,
              state: "OPEN",
              labels: { nodes: [{ name: "atomaton/sub-issue" }, { name: "atomaton/launched" }] },
            })),
          },
        },
      },
    },
  }),
});

describe("dispatch_if_siblings_done.ts", () => {
  test("dispatches the atomaton once all siblings are done", () => {
    const configDir = makeConfigDir({});
    try {
      const r = runWithFakeGh(
        scriptPath("dispatch_if_siblings_done.ts"),
        ["--repo", "owner/repo", "--parent", "5", "--closed-num", "9"],
        {
          cwd: configDir,
          rules: [
            subIssues(),
            { match: ["issue", "view", "comments"], stdout: "" },
            { match: ["issue", "comment"] },
            { match: ["workflow", "run"] },
            // The parent's state. `dispatchRunner` refuses to start an agent on
            // anything it cannot confirm is open, so the happy path has to say so.
            { match: ["api", "issues"], stdout: JSON.stringify({ state: "open" }) },
          ],
        },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(true);
      expect(r.ghCalls.some((c) => c[0] === "workflow" && c[1] === "run")).toBe(true);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  test("skips dispatch when the aggregation marker is already present", () => {
    const configDir = makeConfigDir({});
    try {
      const r = runWithFakeGh(
        scriptPath("dispatch_if_siblings_done.ts"),
        ["--repo", "owner/repo", "--parent", "5", "--closed-num", "9"],
        {
          cwd: configDir,
          rules: [
            subIssues(),
            { match: ["issue", "view", "comments"], stdout: "<!-- atomaton:aggregated=9 -->\nAtomaton: All sub-tasks completed." },
          ],
        },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
      expect(r.ghCalls.some((c) => c[0] === "workflow")).toBe(false);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  test("does nothing when siblings are still open", () => {
    const configDir = makeConfigDir({});
    try {
      const r = runWithFakeGh(
        scriptPath("dispatch_if_siblings_done.ts"),
        ["--repo", "owner/repo", "--parent", "5", "--closed-num", "9"],
        { cwd: configDir, rules: [subIssues(1)] },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
      expect(r.ghCalls.some((c) => c[0] === "workflow")).toBe(false);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

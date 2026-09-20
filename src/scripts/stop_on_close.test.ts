import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { makeConfigDir, runWithFakeGh, scriptPath } from "./testing/harness.ts";

/**
 * Closing ends a line of work, not one node. What these assert is the reach: the right
 * closes stop and close everything under them, and the wrong ones touch nothing.
 *
 * The pull request rule names the tag it searches for, and that is not decoration. The
 * fake `gh` matches a rule when each string appears somewhere in the argv, and the
 * pull request search carries `atomaton:parent-issue=` — which contains "issue". A bare
 * `["issue", "list"]` rule therefore swallowed the `gh pr list` call as well, and the
 * pull request half of the tree came back empty while every assertion about it still
 * read as if it had been looked for. Two tests passed that way before this was written.
 */
describe("stop_on_close.ts", () => {
  const RUNNING_ROOT = JSON.stringify({ state: "open", labels: [{ name: "atomaton/in-progress" }] });
  const CLOSED_ARGS = ["--number", "803", "--closer", "octocat", "--closer-type", "User"];

  /**
   * The sub-issues under a node, as GitHub's own links report them.
   *
   * They used to come from an `atomaton:parent=N in:body` search, and these fixtures
   * were about that half with the native half answering empty. The tag is gone and
   * the link is the record — see `lib/parent-issue.ts`. Pull requests are still found
   * by their own tag, because GitHub does not keep its PR-to-issue link in this
   * design.
   */
  const subIssues = (...children: { number: number; running?: boolean; state?: string }[]) => ({
    match: ["api", "graphql"],
    stdout: JSON.stringify({
      data: {
        repository: {
          issueOrPullRequest: {
            __typename: "Issue",
            parent: null,
            subIssues: {
              nodes: children.map((child) => ({
                number: child.number,
                title: `#${child.number}`,
                state: child.state ?? "OPEN",
                labels: { nodes: child.running ? [{ name: "atomaton/in-progress" }] : [] },
              })),
            },
            closedByPullRequestsReferences: { nodes: [] },
            timelineItems: { nodes: [] },
          },
        },
      },
    }),
  });
  const NO_NATIVE_LINKS = subIssues();

  function run(args: string[], rules: { match: string[]; stdout?: string; code?: number }[]) {
    const configDir = makeConfigDir({});
    try {
      return runWithFakeGh(scriptPath("stop_on_close.ts"), args, {
        cwd: configDir,
        env: { GITHUB_REPOSITORY: "owner/repo" },
        rules,
      });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  }

  test("asks the run to stop, and says so where the run is looking", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: RUNNING_ROOT },
      { match: ["pr", "list", "parent-issue="], stdout: "[]" },
      NO_NATIVE_LINKS,
      { match: ["issue", "comment"] },
    ]);
    expect(r.status).toBe(0);
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    // The stop tag is the request: the running job polls for it. Without it this is a
    // notice telling somebody a stop is coming that never arrives.
    expect(comment).toContain("atomaton:stop=requested");
    expect(comment).toContain("Closing does not stop a run by itself");
    // The run's own result comment says those, seconds later, and mentions them there.
    expect(comment).not.toContain("@octocat");
    expect(comment).not.toContain("/resume");
  });

  /**
   * An agent closing the issue it is working on is how it finishes. The workflow gates
   * on this too; the script refuses as well, so the rule survives being called from
   * somewhere else.
   */
  test("a bot's close reaches nothing, and reads nothing to find that out", () => {
    const r = run(["--number", "803", "--closer", "atomaton-bot", "--closer-type", "Bot"], []);
    expect(r.status).toBe(0);
    expect(r.ghCalls).toEqual([]);
  });

  /**
   * The case the old shape got wrong. It read the root's label, found none, and
   * returned — right about the root and wrong about the work, because an issue can be
   * closed with nothing running on it and a live chain underneath.
   */
  test("closes the work under an issue even when nothing was running on it", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: JSON.stringify({ state: "closed", labels: [] }) },
      { match: ["pr", "list", "parent-issue="], stdout: "[]" },
      subIssues({ number: 807 }),
      { match: ["issue", "comment"] },
      { match: ["issue", "close"] },
    ]);
    expect(r.status).toBe(0);
    expect(r.ghCalls.some((c) => c[0] === "issue" && c[1] === "close" && c.includes("807"))).toBe(true);
  });

  test("nothing running and nothing open under it is nothing to do", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: JSON.stringify({ state: "closed", labels: [] }) },
      { match: ["pr", "list", "parent-issue="], stdout: "[]" },
      NO_NATIVE_LINKS,
    ]);
    expect(r.status).toBe(0);
    expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
    expect(r.ghCalls.some((c) => c.includes("close"))).toBe(false);
  });

  /**
   * A failed read is not "nothing to do". Answering it as one would close an issue and
   * leave the chain under it running, with nobody told.
   */
  test("a tree it could not read fails loudly rather than staying quiet", () => {
    const r = run(CLOSED_ARGS, [{ match: ["api", "issues/803"], code: 1, stdout: "gh: not found" }]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("::error::");
    expect(r.ghCalls.some((c) => c.includes("close"))).toBe(false);
  });

  /**
   * A stop reaches every running node under the closed one, and each is told where it
   * came from — nobody typed anything there, and an unexplained stop reads as a
   * malfunction.
   */
  test("a running sub-issue is stopped and told why", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: RUNNING_ROOT },
      { match: ["pr", "list", "parent-issue="], stdout: "[]" },
      subIssues({ number: 807, running: true }),
      { match: ["issue", "comment"] },
      { match: ["issue", "close"] },
    ]);
    expect(r.status).toBe(0);
    const toChild = r.ghCalls.find((c) => c.includes("comment") && c.includes("807"))?.join(" ") ?? "";
    expect(toChild).toContain("atomaton:stop=requested");
    expect(toChild).toContain("#803 was closed");
  });

  /**
   * A merged pull request has left the tree: GitHub cannot close one, and attempting it
   * would report a failure that is not one.
   */
  test("a merged pull request under the issue is left alone", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: RUNNING_ROOT },
      {
        match: ["pr", "list", "parent-issue="],
        stdout: JSON.stringify([
          { number: 817, body: "<!-- atomaton:parent-issue=803 -->", state: "MERGED", labels: [] },
        ]),
      },
      NO_NATIVE_LINKS,
      { match: ["issue", "comment"] },
    ]);
    expect(r.status).toBe(0);
    expect(r.ghCalls.some((c) => c[0] === "pr" && c[1] === "close")).toBe(false);
  });

  /** An open pull request is a node like any other, and closes with its issue. */
  test("an open pull request under the issue is closed with it", () => {
    const r = run(CLOSED_ARGS, [
      { match: ["api", "issues/803"], stdout: RUNNING_ROOT },
      {
        match: ["pr", "list", "parent-issue="],
        stdout: JSON.stringify([
          { number: 826, body: "<!-- atomaton:parent-issue=803 -->", state: "OPEN", labels: [] },
        ]),
      },
      NO_NATIVE_LINKS,
      { match: ["issue", "comment"] },
      { match: ["pr", "close"] },
    ]);
    expect(r.status).toBe(0);
    expect(r.ghCalls.some((c) => c[0] === "pr" && c[1] === "close" && c.includes("826"))).toBe(true);
  });
});

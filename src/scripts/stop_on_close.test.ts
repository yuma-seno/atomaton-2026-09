import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { makeConfigDir, runWithFakeGh, scriptPath } from "./testing/harness.ts";

/**
 * The gesture this makes honest. Closing an issue looked like stopping the run on it
 * and did nothing, so what these assert is not that a comment is posted but that the
 * right closes post one and the wrong ones stay silent.
 */
describe("stop_on_close.ts", () => {
  const ISSUE_IN_PROGRESS = JSON.stringify({
    labels: [{ name: "atomaton/in-progress" }],
    user: { login: "atomaton-bot", type: "Bot" },
  });

  function run(args: string[], rules: { match: string[]; stdout?: string; code?: number }[]) {
    const configDir = makeConfigDir({});
    try {
      return {
        ...runWithFakeGh(scriptPath("stop_on_close.ts"), args, {
          cwd: configDir,
          env: { GITHUB_REPOSITORY: "owner/repo" },
          rules,
        }),
        configDir,
      };
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  }

  test("asks the run to stop, and says so where the run is looking", () => {
    const r = run(
      ["--number", "803", "--closer", "octocat", "--closer-type", "User"],
      [
        { match: ["api", "issues/803"], stdout: ISSUE_IN_PROGRESS },
        { match: ["issue", "list"], stdout: "[]" },
        { match: ["issue", "comment"] },
      ],
    );
    expect(r.status).toBe(0);
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    // The stop tag is the request: the running job polls for it. Without it this is
    // a notice telling somebody a stop is coming that never arrives.
    expect(comment).toContain("atomaton:stop=requested");
    expect(comment).toContain("Closing does not stop a run by itself");
    // The run's own result comment says those, seconds later, and mentions them
    // there. Saying it twice was two notifications for one close.
    expect(comment).not.toContain("@octocat");
    expect(comment).not.toContain("/resume");
  });

  /**
   * An agent closing the issue it is working on is how it finishes. The workflow
   * gates on this too; the script refuses as well, so the rule survives somebody
   * calling it from somewhere else.
   */
  test("a bot's close stops nothing, and reads nothing to find that out", () => {
    const r = run(["--number", "803", "--closer", "atomaton-bot", "--closer-type", "Bot"], []);
    expect(r.status).toBe(0);
    expect(r.ghCalls).toEqual([]);
  });

  test("no run holds the issue, so there is nothing to stop", () => {
    const r = run(
      ["--number", "803", "--closer", "octocat", "--closer-type", "User"],
      [{ match: ["api", "issues/803"], stdout: JSON.stringify({ labels: [], user: { login: "octocat", type: "User" } }) }],
    );
    expect(r.status).toBe(0);
    expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
  });

  /**
   * A failed lookup is not "no label". Answering it as one would leave the run going
   * and nobody told, which is the state this script exists to end.
   */
  test("a state it could not read fails loudly rather than staying quiet", () => {
    const r = run(
      ["--number", "803", "--closer", "octocat", "--closer-type", "User"],
      [{ match: ["api", "issues/803"], code: 1, stdout: "gh: not found" }],
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("::error::");
    expect(r.ghCalls.some((c) => c.includes("comment"))).toBe(false);
  });

  /**
   * Nobody is mentioned, whoever filed the issue. The receipt informs; the run's
   * result comment is what calls a person back.
   */
  test("a human author is not mentioned either", () => {
    const r = run(
      ["--number", "803", "--closer", "octocat", "--closer-type", "User"],
      [
        {
          match: ["api", "issues/803"],
          stdout: JSON.stringify({
            labels: [{ name: "atomaton/in-progress" }],
            user: { login: "hubot-human", type: "User" },
          }),
        },
        { match: ["issue", "list"], stdout: "[]" },
        { match: ["issue", "comment"] },
      ],
    );
    expect(r.status).toBe(0);
    const comment = r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "";
    expect(comment).not.toContain("@");
  });

  /**
   * A parent's chain can be running on its children, and closing the parent does not
   * reach them. Saying nothing would leave a person reading a quiet issue as a
   * stopped one.
   */
  test("children still running are named", () => {
    const r = run(
      ["--number", "803", "--closer", "octocat", "--closer-type", "User"],
      [
        { match: ["api", "issues/803"], stdout: ISSUE_IN_PROGRESS },
        {
          match: ["issue", "list"],
          stdout: JSON.stringify([{ number: 807, body: "<!-- atomaton:parent=803 -->" }]),
        },
        { match: ["issue", "comment"] },
      ],
    );
    expect(r.status).toBe(0);
    expect(r.ghCalls.find((c) => c.includes("comment"))?.join(" ") ?? "").toContain("#807");
  });
});

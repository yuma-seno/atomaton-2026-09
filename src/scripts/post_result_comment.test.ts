import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommentBody, lastAgentText } from "./post_result_comment.ts";
import type { Session } from "../lib/session.ts";
import { runWithFakeGh, scriptPath } from "./testing/harness.ts";

describe("post_result_comment.ts buildCommentBody", () => {
  test("mentions notify when there is no directive and the chain does not continue", () => {
    const body = buildCommentBody({
      agent: "orchestrator",
      notify: "octocat",
      runUrl: "http://example.com/run/1",
      output: "All done.",
      usageLines: [],
    });
    expect(body).toContain("<!-- atomaton:agent=orchestrator -->");
    expect(body).toContain("All done.");
    expect(body).toContain("@octocat");
    expect(body).toContain("_run by [orchestrator](http://example.com/run/1)_");
  });

  /**
   * The escaped-mention notice belongs with what the agent wrote, and above the
   * run footer -- somebody scanning the comment for what happened reads the top,
   * and reads the footer only when they want the run.
   */
  test("says so when a mention was defused, between the report and the footer", () => {
    const body = buildCommentBody({
      agent: "engineer",
      runUrl: "http://example.com/run/1",
      output: "Following `@torvalds`' approach.",
      escapedMentions: ["torvalds"],
      usageLines: [],
    });
    expect(body).toContain("Nobody was notified");
    expect(body.indexOf("Nobody was notified")).toBeGreaterThan(body.indexOf("Following"));
    expect(body.indexOf("Nobody was notified")).toBeLessThan(body.indexOf("_run by"));
  });

  test("and says nothing when nothing was defused", () => {
    const body = buildCommentBody({
      agent: "engineer",
      runUrl: "http://example.com/run/1",
      output: "All done.",
      usageLines: [],
    });
    expect(body).not.toContain("Nobody was notified");
  });

  /**
   * The directive names a run that a stop cancelled, so it is a plan rather than a
   * fact and silences nothing. Without this the comment believed the handoff it
   * could see over the stop it could not: nothing ran next, and nobody was told.
   */
  test("keeps the mention when a stop cancelled the directive's handoff", () => {
    const body = buildCommentBody({
      agent: "orchestrator",
      notify: "octocat",
      directive: "engineer",
      stopRequested: "true",
      runUrl: "http://example.com/run/1",
      output: "Handing off.",
      usageLines: [],
    });
    expect(body).toContain("@octocat");
    expect(body).toContain("Stopped on request");
  });

  test("and when a spent iteration budget cancelled it", () => {
    const body = buildCommentBody({
      agent: "orchestrator",
      notify: "octocat",
      directive: "engineer",
      limitReached: "true",
      runUrl: "http://example.com/run/1",
      output: "Handing off.",
      usageLines: [],
    });
    expect(body).toContain("@octocat");
  });

  /**
   * A stop lands at a turn boundary, so a run reading files when it arrives has said
   * nothing and there is nothing to salvage either. The comment is then entirely the
   * machinery's: that it stopped, that the session survived, and how to resume.
   * Saying so outright matters, because a report-shaped comment with no report in it
   * otherwise reads as a run that finished with nothing to say.
   */
  test("says outright when the run was cut short having said nothing", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      wroteNothing: true,
      stopRequested: "true",
      runUrl: "http://example.com/run/1",
      output: "_This run was stopped before it said anything._",
      usageLines: [],
    });
    expect(body).toContain("ended before it said anything at all");
    expect(body).toContain("saved session");
    expect(body).toContain("/resume");
    expect(body).toContain("@octocat");
    // Not the salvage warning: that one promises a sentence from the middle of the
    // work, and there is none.
    expect(body).not.toContain("Below is the last thing it said");
  });

  /**
   * Observed in production on #839, on the first run that reached this line after a
   * stop: the comment told the person who had just stopped the run that it had
   * completed. It had said nothing at all.
   */
  test("does not tell someone who stopped a run that it completed", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      wroteNothing: true,
      stopRequested: "true",
      runUrl: "http://example.com/run/1",
      output: "_This run was stopped before it said anything._",
      usageLines: [],
    });
    expect(body).toContain("@octocat");
    expect(body).toContain("was stopped before it finished");
    expect(body).not.toContain("task completed");
  });

  test("nor that one which ran out of iterations completed", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      limitReached: "true",
      runUrl: "http://example.com/run/1",
      output: "Got partway.",
      usageLines: [],
    });
    expect(body).toContain("ran out of iterations before it finished");
    expect(body).not.toContain("task completed");
  });

  /** The ordinary ending keeps the sentence it always had. */
  test("a run that finished still says so", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      runUrl: "http://example.com/run/1",
      output: "All done.",
      usageLines: [],
    });
    expect(body).toContain("task completed");
  });

  test("omits the mention when a directive is present", () => {
    const body = buildCommentBody({
      agent: "orchestrator",
      notify: "octocat",
      directive: "engineer",
      runUrl: "http://example.com/run/1",
      output: "Handing off.",
      usageLines: [],
    });
    expect(body).not.toContain("@octocat");
  });

  test("omits the mention when the chain already continues", () => {
    const body = buildCommentBody({
      agent: "orchestrator",
      notify: "octocat",
      chainContinues: "true",
      runUrl: "http://example.com/run/1",
      output: "Dispatched.",
      usageLines: [],
    });
    expect(body).not.toContain("@octocat");
  });

  // Closing a sub-issue is what wakes its parent, in a later workflow run that
  // this one cannot see -- so `chainContinues` is false here and the mention
  // would otherwise ask a person to act on work that is still moving.
  test("omits the mention when a closed sub-issue hands back to its parent", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      isSubIssue: true,
      issueClosed: true,
      runUrl: "http://example.com/run/1",
      output: "Merged in PR #173. Closing this sub-task.",
      usageLines: [],
    });
    expect(body).not.toContain("@octocat");
  });

  test("keeps the mention when a sub-issue run ends with the sub-issue open", () => {
    const body = buildCommentBody({
      agent: "engineer",
      notify: "octocat",
      isSubIssue: true,
      issueClosed: false,
      runUrl: "http://example.com/run/1",
      output: "I could not finish this.",
      usageLines: [],
    });
    expect(body).toContain("@octocat");
  });

  test("appends the limit-reached warning", () => {
    const body = buildCommentBody({
      agent: "engineer",
      limitReached: "true",
      runUrl: "http://example.com/run/1",
      output: "Still working.",
      usageLines: [],
    });
    expect(body).toContain("The run reached its limit");
    expect(body).toContain("`/engineer`");
  });
  // The line has to say the session survived: that is the entire difference between
  // a stop and cancelling the workflow run, and the person who asked cannot tell
  // which one they got from anywhere else.
  test("a stop says the session is saved and how to continue", () => {
    const body = buildCommentBody({
      agent: "engineer",
      stopRequested: "true",
      runUrl: "http://example.com/run/1",
      output: "Halfway through.",
      usageLines: [],
    });
    expect(body).toContain("Stopped on request");
    expect(body).toContain("session is saved");
    expect(body).toContain("`/resume`");
  });

  // Both arrive as status 2 and the runner can set both wrong. Saying "reached its
  // limit" to somebody who typed /stop is the confusing half, so the stop wins.
  test("a stop and a limit together read as a stop", () => {
    const body = buildCommentBody({
      agent: "engineer",
      stopRequested: "true",
      limitReached: "true",
      runUrl: "http://example.com/run/1",
      output: "Halfway through.",
      usageLines: [],
    });
    expect(body).toContain("Stopped on request");
    expect(body).not.toContain("reached its limit");
  });
});

describe("post_result_comment.ts main", () => {
  /**
   * The path is required, and this is why.
   *
   * It used to open `atomaton_output.txt` relative to the working directory. A change
   * moved the run's files out of the work tree and the read went to a path that no
   * longer existed -- landing in the "empty output" branch, whose message reads
   * like a session that ended via a tool call. Two releases shipped where no
   * agent's report reached anyone, with every step reporting success.
   *
   * A default would put that back for any caller that forgot the argument. Exiting
   * non-zero instead makes a missing argument a failed step, which is the one thing
   * the original could not be.
   */
  test("refuses to run without --output rather than guessing a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    try {
      // A file the old relative read would have found and posted from.
      writeFileSync(join(dir, "atomaton_output.txt"), "All done.");
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        ["--number", "5", "--agent", "engineer", "--run-url", "http://example.com/run/1"],
        { cwd: dir, rules: [{ match: ["api", "comments"] }] },
      );
      expect(r.status, "a missing --output is a failed step, not a silent skip").not.toBe(0);
      expect(r.ghCalls.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The same empty output, and the opposite answer, because the two empties mean
   * opposite things.
   *
   * A session-ending tool call chose to end and posted its own comment. A stop did
   * not choose anything: it arrives at a turn boundary, so a run reading files when
   * it lands has said nothing and has nothing to salvage. Measured on #831 -- nine
   * iterations, every one a tool call, no assistant text at all. Skipping there
   * drops the machinery's own sentence along with the agent's silence.
   */
  test("posts for a stopped run that said nothing, rather than skipping with it", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    try {
      writeFileSync(join(dir, "atomaton_output.txt"), "");
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        [
          "--number", "831", "--type", "issue", "--agent", "engineer", "--notify", "octocat",
          "--stop-requested", "true", "--run-url", "http://example.com/run/1",
          "--output", join(dir, "atomaton_output.txt"),
        ],
        { cwd: dir, env: { GITHUB_REPOSITORY: "owner/repo" }, rules: [{ match: ["api"], stdout: "{}" }] },
      );
      expect(r.status).toBe(0);
      const posted = r.ghCalls.find((c) => c.some((a) => a.includes("Stopped on request")));
      expect(posted, "a stopped run has to say that it stopped").toBeDefined();
      const body = posted?.join(" ") ?? "";
      expect(body).toContain("ended before it said anything at all");
      expect(body).toContain("/resume");
      expect(body).toContain("@octocat");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips posting entirely when the output file is missing (session ended via a tool call)", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    try {
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        ["--number", "5", "--agent", "orchestrator", "--notify", "octocat", "--run-url", "http://example.com/run/1", "--output", join(dir, "atomaton_output.txt")],
        { cwd: dir, rules: [{ match: ["api", "comments"] }] },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips posting entirely when atomaton_output.txt is blank", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    writeFileSync(join(dir, "atomaton_output.txt"), "   \n");
    try {
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        ["--number", "5", "--agent", "orchestrator", "--run-url", "http://example.com/run/1", "--output", join(dir, "atomaton_output.txt")],
        { cwd: dir, rules: [{ match: ["api", "comments"] }] },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("posts normally when atomaton_output.txt has real content", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    writeFileSync(join(dir, "atomaton_output.txt"), "All done.");
    try {
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        ["--number", "5", "--agent", "orchestrator", "--run-url", "http://example.com/run/1", "--output", join(dir, "atomaton_output.txt")],
        { cwd: dir, env: { GITHUB_REPOSITORY: "owner/repo" }, rules: [{ match: ["api", "comments"], stdout: "42" }] },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.some((c) => c.join(" ").includes("comments"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads the issue's own state to decide the mention, and only for an issue run", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    writeFileSync(join(dir, "atomaton_output.txt"), "Merged and closed.");
    try {
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        // prettier-ignore
        ["--number", "5", "--type", "issue", "--agent", "engineer", "--notify", "octocat", "--run-url", "http://example.com/run/1", "--output", join(dir, "atomaton_output.txt")],
        {
          cwd: dir,
          env: { GITHUB_REPOSITORY: "owner/repo" },
          rules: [
            { match: ["issue", "view", "5"], stdout: JSON.stringify({ state: "CLOSED", body: "<!-- atomaton:parent=4 -->" }) },
            { match: ["api", "comments"], stdout: "42" },
          ],
        },
      );
      expect(r.status).toBe(0);
      const posted = r.ghCalls.find((c) => c.join(" ").includes("comments"))?.join(" ") ?? "";
      expect(posted).not.toContain("@octocat");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A pull request run's `--number` is a PR number, and `gh issue view` on one
  // is an error rather than an answer.
  test("does not look the number up as an issue on a pull request run", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-post-result-"));
    writeFileSync(join(dir, "atomaton_output.txt"), "Reviewed.");
    try {
      const r = runWithFakeGh(
        scriptPath("post_result_comment.ts"),
        ["--number", "7", "--type", "pr", "--agent", "reviewer", "--run-url", "http://example.com/run/1", "--output", join(dir, "atomaton_output.txt")],
        { cwd: dir, env: { GITHUB_REPOSITORY: "owner/repo" }, rules: [{ match: ["api", "comments"], stdout: "42" }] },
      );
      expect(r.status).toBe(0);
      expect(r.ghCalls.some((c) => c.includes("view"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * What a run that ran out of iterations leaves behind.
 *
 * Measured: 17 minutes, 154k tokens, 352 tool calls, and the thread received
 * a one-line notice saying the limit was reached. Everything the run had worked out
 * was in the session, where nobody looks.
 */
describe("salvaging a run that ended before it reported", () => {
  const write = (session: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), "salvage-"));
    const path = join(dir, "session.json");
    writeFileSync(path, JSON.stringify(session));
    return path;
  };

  test("the last thing the agent said, not the last message", () => {
    const path = write({
      messages: [
        { role: "assistant", content: "I checked config.json and found 13 keys." },
        { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
        { role: "tool", tool_call_id: "c1", content: "grep output" },
      ],
    });
    expect(lastAgentText(path, 0)).toBe("I checked config.json and found 13 keys.");
  });

  /**
   * The defect this boundary exists for, measured in production.
   *
   * A session accumulates across runs, and these models write prose exactly once, in
   * their final turn. So a run that is stopped has no assistant text of its own at
   * all, and the newest one in the session belongs to whichever earlier run finished
   * -- which the salvage then published under "this run ended before it wrote a
   * report, below is the last thing it said, from the middle of the work". Every
   * clause of that was false about the text it showed.
   */
  test("an earlier run's conclusion is not this run's fragment", () => {
    const path = write({
      messages: [
        { role: "user", content: "read src/domain" },
        { role: "assistant", content: "Done. Here is the full report on all 32 modules." },
        // This run starts here, and never says anything in words.
        { role: "user", content: "now read src/scripts" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
        { role: "tool", tool_call_id: "c1", content: "file contents" },
      ],
    });
    expect(lastAgentText(path, 2), "the previous report is out of reach").toBeUndefined();
    expect(lastAgentText(path, 0), "and reachable only by looking below the boundary").toBe(
      "Done. Here is the full report on all 32 modules.",
    );
  });

  /**
   * A boundary nobody supplied means nothing is salvaged. Showing a person less than
   * they could have had is a smaller failure than showing them an old conclusion
   * labelled as a new fragment.
   */
  test("no boundary salvages nothing", () => {
    const path = write({
      messages: [{ role: "assistant", content: "something" }],
    });
    expect(lastAgentText(path)).toBeUndefined();
    expect(lastAgentText(path, Number.NaN)).toBeUndefined();
  });

  /**
   * The common shape: the last turns of a run that ran out are tool calls with no
   * words, which is exactly why the output file was empty.
   */
  test("nothing to salvage is a real answer", () => {
    const path = write({
      messages: [
        { role: "user", content: "do the thing" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
      ],
    });
    expect(lastAgentText(path, 0)).toBeUndefined();
  });

  test("a missing or unreadable session salvages nothing rather than failing", () => {
    expect(lastAgentText(undefined, 0)).toBeUndefined();
    expect(lastAgentText("/definitely/not/here.json", 0)).toBeUndefined();
    const path = write("not a session at all");
    expect(lastAgentText(path, 0)).toBeUndefined();
  });

  /**
   * Presenting a sentence from the middle of the work as a conclusion is worse than
   * posting nothing, because a reader would act on it.
   */
  test("the comment says it is not a report", () => {
    const body = buildCommentBody({
      agent: "engineer",
      runUrl: "http://example.com/run/1",
      output: "Now checking whether auto_triggers is read anywhere.",
      salvaged: true,
      usageLines: [],
    });
    expect(body).toContain("ended before it wrote a report");
    expect(body).toContain("not a conclusion");
    expect(body.indexOf("ended before it wrote a report")).toBeLessThan(body.indexOf("Now checking"));
  });

  test("an ordinary report carries no such warning", () => {
    const body = buildCommentBody({
      agent: "engineer",
      runUrl: "http://example.com/run/1",
      output: "Done.",
      usageLines: [],
    });
    expect(body).not.toContain("ended before it wrote a report");
  });
});

/**
 * The footer is the one line of every comment somebody actually reads twice, and the
 * report it links to is written on a branch nobody browses by accident.
 */
describe("the metrics link in the footer", () => {
  const base = {
    agent: "engineer",
    runUrl: "https://example.com/run",
    output: "done",
    usageLines: [] as string[],
  };

  test("it points at the report on atomaton-data", () => {
    expect(buildCommentBody({ ...base, repo: "acme/widgets" })).toContain(
      "[metrics](https://github.com/acme/widgets/blob/atomaton-data/metrics/report.md)",
    );
  });

  /** A broken link in every comment is worse than no link in any of them. */
  test("an unknown repository means no link rather than a guessed one", () => {
    const body = buildCommentBody(base);
    expect(body).toContain("_run by [engineer](https://example.com/run)_");
    expect(body).not.toContain("metrics");
  });
});

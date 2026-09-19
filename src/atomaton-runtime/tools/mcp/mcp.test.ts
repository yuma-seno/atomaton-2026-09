import { describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// The servers are spawned with the ambient environment, and inside an Atomaton run that
// includes the run's own `ATOMATON_RUN_TYPE` and `ISSUE_NUMBER`. See `hermeticEnv`.
import { hermeticEnv } from "../../../scripts/testing/harness.ts";

const SCRIPTS_DIR = join(process.cwd(), "src/atomaton-runtime/tools/mcp");
import { FAKE_GH_IMPL } from "../../../scripts/testing/fake-gh-env.ts";
import { removeTemp } from "../../../scripts/testing/harness.ts";

/**
 * Point this server's `gh` at the fake, and leave the real one unusable.
 *
 * PATH cannot carry this on Windows -- see `ghCommand` in `lib/gh.ts`. It was tried
 * here too, and the way it failed was to reach the real CLI with the developer's own
 * credentials: a GraphQL fixture in this file was answered by GitHub itself.
 */
function fakeGhSeam(): Record<string, string> {
  return {
    ATOMATON_FAKE_GH: FAKE_GH_IMPL,
    GH_TOKEN: "fake-gh-must-be-used",
    GITHUB_TOKEN: "fake-gh-must-be-used",
  };
}

/**
 * Send one JSON-RPC request to a server and resolve its first response line.
 *
 * `timeoutMs` is a parameter rather than a fixed five seconds because how long a
 * server takes to answer `initialize` is a property of that server, not of this
 * harness. Every server answers well inside the default now, including `search.ts`,
 * which used to answer in minutes and had no test for that reason.
 */
function sendRequest(
  script: string,
  request: Record<string, unknown>,
  env: Record<string, string> = {},
  cwd = process.cwd(),
  extraArgs: string[] = [],
  timeoutMs = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", `${SCRIPTS_DIR}/${script}`, ...extraArgs], {
      env: { ...hermeticEnv(), GITHUB_REPOSITORY: "owner/repo", ...env },
      cwd,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out waiting for response from ${script}`));
    }, timeoutMs);
    child.stdout.on("data", () => {
      const line = out.split("\n").find((l) => l.trim());
      if (line) {
        clearTimeout(timer);
        child.kill();
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(e);
        }
      }
    });
    child.stdin.write(JSON.stringify(request) + "\n");
  });
}

const INIT_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
};

const INIT_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: INIT_PARAMS,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRemoteBranchFixture(): { root: string; seed: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), "atomaton-sync-branch-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const work = join(root, "work");
  git(root, "init", "--bare", "--initial-branch=atomaton/issue-1", remote);
  git(root, "init", "--initial-branch=atomaton/issue-1", seed);
  git(seed, "config", "user.name", "Atomaton Test");
  git(seed, "config", "user.email", "atomaton@example.com");
  writeFileSync(join(seed, "value.txt"), "one\n");
  git(seed, "add", "value.txt");
  git(seed, "commit", "-m", "initial");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-u", "origin", "atomaton/issue-1");
  git(root, "clone", "--branch", "atomaton/issue-1", remote, work);
  return { root, seed, work };
}

function advanceRemote(seed: string): string {
  writeFileSync(join(seed, "value.txt"), "two\n");
  git(seed, "add", "value.txt");
  git(seed, "commit", "-m", "remote update");
  git(seed, "push", "origin", "atomaton/issue-1");
  return git(seed, "rev-parse", "HEAD");
}

describe("mcp/github.ts", () => {
  test("initialize returns server info", async () => {
    const r = await sendRequest("github.ts", {
      jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS,
    });
    expect(r.result.serverInfo.name).toBe("atomaton-github-mcp");
  });

  test("tools/list exposes the expected tool set", async () => {
    const r = await sendRequest("github.ts", {
      jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
    });
    const names = r.result.tools.map((t: { name: string }) => t.name);
    for (const tool of ["create_issue", "create_pr", "get_issue", "search_code", "get_pr_diff", "sync_branch"]) {
      expect(names).toContain(tool);
    }
  });

  test("sync_branch fast-forwards a clean branch from origin", async () => {
    const { root, seed, work } = makeRemoteBranchFixture();

    try {
      const remoteHead = advanceRemote(seed);

      const response = await sendRequest(
        "github.ts",
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sync_branch", arguments: {} } },
        { BRANCH: "atomaton/issue-1" },
        work,
      );
      const result = JSON.parse(response.result.content[0].text) as { status: string; behind: number };
      expect(result).toMatchObject({ status: "fast_forwarded", behind: 1 });
      expect(git(work, "rev-parse", "HEAD")).toBe(remoteHead);
    } finally {
      removeTemp(root);
    }
  });

  test("create_pr rejects an unsynchronized HEAD without pushing", async () => {
    const { root, seed, work } = makeRemoteBranchFixture();
    try {
      advanceRemote(seed);
      const localHead = git(work, "rev-parse", "HEAD");

      const response = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "create_pr", arguments: { title: "Test PR" } },
        },
        { BRANCH: "atomaton/issue-1" },
        work,
      );
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("Call github__sync_branch");
      expect(git(work, "rev-parse", "HEAD")).toBe(localHead);
    } finally {
      removeTemp(root);
    }
  });

  /**
   * A `pr` run's worktree: checked out at `refs/pull/<n>/head` with no local branch,
   * which is what #803 hit. `git branch --points-at HEAD` prints git's own
   * description of the detached HEAD, and that description used to be handed to
   * `git push -u origin <that>` as a refspec.
   *
   * Two things have to hold, and the second is the one that matters: the refusal
   * says what the run cannot do, and NO COMMIT IS MADE -- `commitAndPush` resolves
   * the branch before `git add -A` and `git commit` for exactly this reason, so the
   * work stays in the worktree where the agent can still report it. A commit that
   * cannot be pushed is work the run loses.
   */
  test("commit_and_push on a detached HEAD refuses before committing", async () => {
    const { root, work } = makeRemoteBranchFixture();
    try {
      git(work, "config", "user.name", "Atomaton Test");
      git(work, "config", "user.email", "atomaton@example.com");
      git(work, "checkout", "--detach", "HEAD");
      git(work, "branch", "-D", "atomaton/issue-1");
      writeFileSync(join(work, "fix.txt"), "the fix\n");
      const before = git(work, "rev-parse", "HEAD");

      const response = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "commit_and_push", arguments: { message: "fix the findings" } },
        },
        // What the runner sets on a `pr` run: the branch env is the literal HEAD.
        { BRANCH: "HEAD", ATOMATON_RUN_TYPE: "pr", ISSUE_NUMBER: "802" },
        work,
      );

      expect(response.result.isError).toBe(true);
      const message = response.result.content[0].text as string;
      expect(message, "the refusal names the state, not a git refspec").toContain("no branch to push");
      expect(message).not.toContain("refspec");
      // The part that matters: no commit was created, and the change is still there.
      expect(git(work, "rev-parse", "HEAD"), "a commit was stranded").toBe(before);
      expect(git(work, "status", "--porcelain")).toContain("fix.txt");
    } finally {
      removeTemp(root);
    }
  });

  test("create_pr on a detached HEAD refuses with the same message", async () => {
    const { root, work } = makeRemoteBranchFixture();
    try {
      git(work, "checkout", "--detach", "HEAD");
      git(work, "branch", "-D", "atomaton/issue-1");

      const response = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "create_pr", arguments: { title: "Test PR" } },
        },
        {
          BRANCH: "HEAD",
          ATOMATON_RUN_TYPE: "pr",
          ISSUE_NUMBER: "802",
          ...fakeGhSeam(),
          FAKE_GH_RESPONSES: "[]",
        },
        work,
      );

      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("no branch to push");
    } finally {
      removeTemp(root);
    }
  });

  /**
   * The other half: the routes that must keep working. An `issue` run starts on the
   * base branch with no branch of its own, `commit_and_push` names one at the first
   * commit, and `create_pr` then reads that same branch back out of HEAD. Verifying
   * the branch with `show-ref` is new, so this is what says it did not break the
   * ordinary path.
   */
  // A whole git repository built, cloned and driven through two MCP tools, each of
  // which spawns a server and several `gh` calls. Bun`s default 5s does not cover
  // that on Windows -- and until the fake was reachable here, this never ran far
  // enough to say so.
  test("an issue run still creates its branch and opens a pull request from it", async () => {
    const { root, work } = makeRemoteBranchFixture();
    const dir = mkdtempSync(join(tmpdir(), "atomaton-issue-branch-"));
    const log = join(dir, "gh.log");
    try {
      git(work, "config", "user.name", "Atomaton Test");
      git(work, "config", "user.email", "atomaton@example.com");
      // The runner checks out the base branch when there is nothing to resume.
      git(work, "checkout", "-B", "main");
      git(work, "branch", "-D", "atomaton/issue-1");
      writeFileSync(join(work, "work.txt"), "the work\n");

      const env = {
        ATOMATON_RUN_TYPE: "issue",
        ISSUE_NUMBER: "1",
        BRANCH: "",
        ...fakeGhSeam(),
        FAKE_GH_LOG: log,
        FAKE_GH_RESPONSES: JSON.stringify([
          { match: ["matching-refs"], stdout: "[]" },
          { match: ["issue", "view", "1"], stdout: "" },
          { match: ["pr", "list"], stdout: "[]" },
          { match: ["pr", "create"], stdout: "https://github.com/owner/repo/pull/123" },
          { match: ["workflow", "run"], stdout: "" },
          { match: ["api", "issues/123"], stdout: JSON.stringify({ body: "", login: "someone", type: "User" }) },
          { match: ["issue", "comment"], stdout: "" },
          { match: ["pr", "comment"], stdout: "" },
        ]),
      };

      const pushed = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: "commit_and_push", arguments: { message: "do the work" } },
        },
        env,
        work,
      );
      expect(pushed.result.isError, pushed.result.content?.[0]?.text).toBeFalsy();
      expect(JSON.parse(pushed.result.content[0].text)).toMatchObject({ committed: true, pushed: true });
      expect(git(work, "branch", "--show-current")).toBe("atomaton/issue-1");

      const opened = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "create_pr", arguments: { title: "Test PR" } },
        },
        env,
        work,
      );
      expect(opened.result.isError, opened.result.content?.[0]?.text).toBeFalsy();
      expect(JSON.parse(opened.result.content[0].text).number).toBe(123);
      // `gh pr create` was handed the branch the commit created, not HEAD or a
      // detached-HEAD description.
      const created = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
        .find((argv) => argv.includes("pr") && argv.includes("create"));
      expect(created).toContain("atomaton/issue-1");
    } finally {
      removeTemp(root);
      removeTemp(dir);
    }
  }, 60_000);

  test("sync_branch reports divergence without rewriting local history", async () => {
    const { root, seed, work } = makeRemoteBranchFixture();
    try {
      advanceRemote(seed);
      git(work, "config", "user.name", "Atomaton Test");
      git(work, "config", "user.email", "atomaton@example.com");
      writeFileSync(join(work, "local.txt"), "local\n");
      git(work, "add", "local.txt");
      git(work, "commit", "-m", "local update");
      const localHead = git(work, "rev-parse", "HEAD");

      const response = await sendRequest(
        "github.ts",
        { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sync_branch", arguments: {} } },
        { BRANCH: "atomaton/issue-1" },
        work,
      );
      const result = JSON.parse(response.result.content[0].text) as { status: string; ahead: number; behind: number };
      expect(result).toMatchObject({ status: "diverged", ahead: 1, behind: 1 });
      expect(git(work, "rev-parse", "HEAD")).toBe(localHead);
    } finally {
      removeTemp(root);
    }
  });

  test("create_issue rejects malformed gh output", async () => {
    const r = await sendRequest(
      "github.ts",
      {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "create_issue", arguments: { title: "Test", sub_issue: false } },
      },
      {
        ...fakeGhSeam(),
        FAKE_GH_RESPONSES: JSON.stringify([{ match: ["issue", "create"], stdout: "not-a-url" }]),
      },
    );
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("gh issue create: unexpected output");
  });

  /**
   * The tag decides who hears about this work, so an agent that can write it can
   * redirect the report of its own failure or address it to a name nobody reads.
   * `create_pr` refused this and `create_issue` did not, and the asymmetry mattered
   * most exactly when the requester was unknown -- with no machine tag to win the
   * first match, the agent's was the only one in the body.
   */
  /**
   * Agent prose landing where people read gets its mentions checked.
   *
   * Written against `submit_pr_review`, which was the one such place that had never
   * had the check and the likeliest to name somebody. That tool is gone -- a review
   * the shared identity cannot approve or request changes on said the same thing as
   * the run's final message -- so the same property is held here on a body that is
   * still written.
   */
  test("a body an agent writes escapes a mention it cannot vouch for", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-body-mentions-"));
    const log = join(dir, "gh.log");
    try {
      await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0", id: 41, method: "tools/call",
          params: {
            name: "create_issue",
            arguments: { title: "A defect", body: "Looks right. @torvalds should see this.", sub_issue: false },
          },
        },
        {
          ...fakeGhSeam(),
          FAKE_GH_LOG: log,
          FAKE_GH_RESPONSES: JSON.stringify([{ match: ["issue", "create"], stdout: "https://github.com/o/r/issues/7" }]),
        },
      );
      // The argv as issued, rather than the log as text: what matters is the string gh
      // was handed, and reading it back through JSON is how every other test here does it.
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      const body = calls.find((argv) => argv.includes("--body"))?.at(-1) ?? "";
      // Backticked, so GitHub sends no notification and the name still reads.
      expect(body).toContain("Looks right. `@torvalds` should see this.");
      // And the notice the other three paths add, so a person reading the review can see
      // that a mention was intended and did not happen.
      expect(body).toContain("had the notification removed");
    } finally {
      removeTemp(dir);
    }
  });

  test("create_issue refuses a body that already names who to notify", async () => {
    const r = await sendRequest(
      "github.ts",
      {
        jsonrpc: "2.0", id: 31, method: "tools/call",
        params: {
          name: "create_issue",
          arguments: { title: "Test", body: "<!-- atomaton:notify=someone-else -->", sub_issue: false },
        },
      },
      {
        ...fakeGhSeam(),
        FAKE_GH_RESPONSES: JSON.stringify([{ match: ["issue", "create"], stdout: "https://github.com/o/r/issues/1" }]),
      },
    );
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("already contains a notify tag");
  });

  test("create_issue provisions the sub-issue label before creating a child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-create-sub-issue-"));
    const log = join(dir, "gh.log");
    try {
      const response = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0", id: 4, method: "tools/call",
          params: { name: "create_issue", arguments: { title: "Child task" } },
        },
        {
          ...fakeGhSeam(),
          FAKE_GH_LOG: log,
          FAKE_GH_RESPONSES: JSON.stringify([
            { match: ["label", "create", "atomaton/sub-issue"] },
            { match: ["issue", "create"], stdout: "https://github.com/owner/repo/issues/12" },
          ]),
        },
      );
      expect(response.result.isError).toBe(false);
      const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(calls[0]).toContain("--force");
      expect(calls[1]).toContain("atomaton/sub-issue");
    } finally {
      removeTemp(dir);
    }
  });

  /**
   * The readers built on `gh api` returned the response whole.
   *
   * That is not a small waste. A tool result joins the session on the
   * `atomaton-data` branch and is resent on every later inference in it, so an
   * unread field is rent charged for the rest of the issue's life. Measured on
   * this repository before these projections existed: `get_check_runs` returned
   * 24,954 bytes for eight check runs, of which the `app` object was 2,244 bytes
   * PER RUN -- the same GitHub App description eight times -- and `get_branch`
   * returned 11,614 bytes to say a branch exists, 11,164 of it the head commit
   * object nobody asked for.
   *
   * The fixtures below carry the real field names from those payloads, so a
   * rename upstream shows up here rather than as a projection that silently
   * returns nothing.
   */
  describe("projections", () => {
    const call = (name: string, args: Record<string, unknown>, responses: unknown[]) =>
      sendRequest(
        "github.ts",
        { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name, arguments: args } },
        {
          ...fakeGhSeam(),
          FAKE_GH_RESPONSES: JSON.stringify(responses),
        },
      );

    test("get_check_runs keeps what a reader acts on and drops the rest", async () => {
      const payload = {
        check_runs: [
          {
            id: 1,
            name: "atomaton-check",
            node_id: "CR_x",
            head_sha: "abc",
            external_id: "e",
            url: "https://api.github.com/x",
            html_url: "https://github.com/owner/repo/actions/runs/1/job/2",
            details_url: "https://github.com/owner/repo/actions/runs/1/job/2",
            status: "completed",
            conclusion: "success",
            started_at: "2026-01-01T00:00:00Z",
            completed_at: "2026-01-01T00:01:00Z",
            output: { title: null, summary: null, text: null },
            check_suite: { id: 9 },
            app: { id: 15368, slug: "github-actions", description: "x".repeat(2000) },
            pull_requests: [{ id: 7 }],
          },
        ],
      };
      const r = await call("get_check_runs", { ref: "abc" }, [
        { match: ["check-runs"], stdout: JSON.stringify(payload) },
      ]);
      const runs = JSON.parse(r.result.content[0].text);
      expect(runs).toEqual([
        {
          name: "atomaton-check",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/owner/repo/actions/runs/1/job/2",
        },
      ]);
      // The 2KB App description is the whole point of the projection.
      expect(r.result.content[0].text).not.toContain("xxxx");
    });

    test("get_branch answers the question without the head commit object", async () => {
      const payload = {
        name: "main",
        commit: { sha: "deadbeef", commit: { message: "m".repeat(4000) }, author: { login: "a" } },
        _links: { self: "u" },
        protected: true,
        protection: { enabled: true },
        protection_url: "u",
      };
      // Called with `name`, which is no longer what this tool declares: the schema says
      // `branch`, to match `sync_branch` beside it, and `name` is folded in as the
      // synonym it is. Left this way deliberately -- it is the only place that path is
      // exercised end to end.
      const r = await call("get_branch", { name: "main" }, [
        { match: ["branches/main"], stdout: JSON.stringify(payload) },
      ]);
      expect(JSON.parse(r.result.content[0].text)).toEqual({
        branch: "main",
        exists: true,
        sha: "deadbeef",
        protected: true,
      });
      expect(r.result.content[0].text).not.toContain("mmmm");
    });

    /**
     * The branch that is not there.
     *
     * Six recorded calls asked about `atomaton/issue-104`, `atomaton/issue-190` and
     * `atomaton/issue-219` before creating them, and every one was charged an error for
     * asking a question this tool exists to answer. The property is that a missing
     * branch is a result -- not the exact wording of the field, which a later reader
     * may well improve.
     */
    test("a branch that does not exist is an answer, not an error", async () => {
      const r = await call("get_branch", { branch: "atomaton/issue-104" }, [
        { match: ["branches/atomaton/issue-104"], code: 1, stdout: "gh: Branch not found (HTTP 404)" },
      ]);
      expect(r.result.isError).toBe(false);
      expect(JSON.parse(r.result.content[0].text)).toEqual({ branch: "atomaton/issue-104", exists: false });
    });

    /**
     * A 404 is an answer; anything else is the absence of one. Reporting "no such
     * branch" because GitHub was down would be a confident wrong answer in exactly the
     * place a caller is deciding whether to create something.
     */
    test("a server error is still an error, not a missing branch", async () => {
      const r = await call("get_branch", { branch: "main" }, [
        { match: ["branches/main"], code: 1, stdout: "gh: Server Error (HTTP 500)" },
      ]);
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0].text).not.toContain("exists");
    });

    /**
     * Measured on `submit_pr_review`, since removed: 28 calls with `{event, body}`
     * and no number. The guidance it prompted is still on every mutation that needs
     * one, and this holds it on one of those.
     *
     * The number stays required -- this writes to GitHub, and the rule that mutations
     * do not infer their target is deliberate and stays. What is tested here is the
     * refusal: it has to name the number to pass, because a refusal that says what to
     * do next is followed and one that only restates the schema is not.
     */
    test("a mutation that needs a number says which number", async () => {
      const r = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0", id: 44, method: "tools/call",
          params: { name: "merge_pr", arguments: {} },
        },
        {
          ...fakeGhSeam(),
          FAKE_GH_RESPONSES: "[]",
          ATOMATON_RUN_TYPE: "pr",
          ISSUE_NUMBER: "305",
        },
      );
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0].text).toContain("305");
    });

    /**
     * GitHub allows ten code searches a minute, and a 429 names its own wait. Thirty
     * recorded failures were that, each one costing an iteration to learn something the
     * error had already said. The property is that the answer arrives, not how many
     * times it was asked for.
     */
    test("a rate-limited search waits out the limit instead of failing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "atomaton-search-retry-"));
      const log = join(dir, "gh.log");
      try {
        const r = await sendRequest(
          "github.ts",
          {
            jsonrpc: "2.0", id: 45, method: "tools/call",
            params: { name: "search_code", arguments: { query: "atomaton_github" } },
          },
          {
            ...fakeGhSeam(),
            FAKE_GH_LOG: log,
            FAKE_GH_RESPONSES: JSON.stringify([
              // A wait GitHub states in milliseconds keeps the test honest and quick:
              // the code reads the stated number rather than using its own backoff.
              { match: ["search", "code"], attempt: 1, code: 1, stdout: "HTTP 429: try again in 0.01s" },
              { match: ["search", "code"], stdout: "main.rs:12: atomaton_github" },
            ]),
          },
        );
        expect(r.result.isError).toBe(false);
        expect(r.result.content[0].text).toContain("atomaton_github");
        // Asked twice, which is the whole point.
        expect(readFileSync(log, "utf8").split("\n").filter(Boolean).length).toBe(2);
      } finally {
        removeTemp(dir);
      }
    });
    test("get_pr_reviews drops the fields nothing decides on", async () => {
      const payload = {
        reviews: [
          {
            id: "PRR_1",
            author: { login: "reviewer" },
            authorAssociation: "COLLABORATOR",
            body: "looks good",
            submittedAt: "2026-01-01T00:00:00Z",
            includesCreatedEdit: false,
            reactionGroups: [],
            state: "APPROVED",
            commit: { oid: "abc" },
          },
        ],
      };
      const r = await call("get_pr_reviews", { number: 1 }, [
        { match: ["--json", "reviews"], stdout: JSON.stringify(payload) },
      ]);
      expect(JSON.parse(r.result.content[0].text)).toEqual({
        total: 1,
        omitted: 0,
        reviews: [
          { author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-01-01T00:00:00Z", body: "looks good" },
        ],
      });
    });

    test("list_pr_review_comments keeps where it is and what it says", async () => {
      const payload = [
        {
          id: 1,
          user: { login: "reviewer", avatar_url: "u", url: "u", html_url: "u", followers_url: "u" },
          path: "src/x.ts",
          line: 42,
          original_line: 40,
          in_reply_to_id: 99,
          diff_hunk: "@@ -1 +1 @@\n-old\n+new",
          body: "rename this",
          author_association: "COLLABORATOR",
        },
      ];
      const r = await call("list_pr_review_comments", { number: 1 }, [
        { match: ["pulls/1/comments"], stdout: JSON.stringify(payload) },
      ]);
      expect(JSON.parse(r.result.content[0].text)).toEqual({
        total: 1,
        omitted: 0,
        comments: [{ author: "reviewer", path: "src/x.ts", line: 42, in_reply_to: 99, body: "rename this" }],
      });
    });

    // A count limit is not a volume limit: the range bounds how MANY comments come
    // back and said nothing about how big one is.
    test("get_issue_comments caps one oversized comment", async () => {
      const body = "y".repeat(40_000);
      const payload = { title: "t", state: "OPEN", comments: [{ author: { login: "a" }, body }] };
      const r = await call("get_issue_comments", { number: 1, from: 1, to: 1 }, [
        { match: ["--json", "comments"], stdout: JSON.stringify(payload) },
      ]);
      const parsed = JSON.parse(r.result.content[0].text);
      expect(parsed.comments[0].body.length).toBeLessThan(body.length);
      expect(parsed.comments[0].body).toContain("characters");
      // And it still says how many there were, which is what stops "not shown"
      // being read as "not there".
      expect(parsed.showing).toBeDefined();
    });

    /**
     * The header carries all three links, not two.
     *
     * `children` was the one it left out, and nothing said why -- the same
     * `issueLinks` call already holds it. What its absence costs is the question a
     * reviewer asks most often of a parent: is anything under this still open. The
     * comments alone cannot answer that, which is the whole reason the header exists.
     */
    test("get_issue_comments carries children beside parent and pull requests", async () => {
      const payload = { title: "t", state: "OPEN", comments: [] };
      const links = {
        data: {
          repository: {
            issueOrPullRequest: {
              __typename: "Issue",
              parent: null,
              subIssues: { nodes: [{ number: 807, title: "child", state: "OPEN" }] },
              closedByPullRequestsReferences: { nodes: [] },
              timelineItems: { nodes: [] },
            },
          },
        },
      };
      const r = await call("get_issue_comments", { number: 803 }, [
        { match: ["api", "graphql"], stdout: JSON.stringify(links) },
        { match: ["--json", "comments"], stdout: JSON.stringify(payload) },
      ]);
      const parsed = JSON.parse(r.result.content[0].text);
      expect(parsed.issue.children).toEqual([{ number: 807, title: "child", state: "open" }]);
      expect(parsed.issue.pull_requests).toEqual([]);
      expect(parsed.issue.links_unavailable).toBeUndefined();
    });
  });

  // The advertised JSON Schema is what teaches the model the correct shape, and
  // zod-to-json-schema is known to degrade silently to `{}` for schemas built
  // the wrong way (see lib/mcp-tool.ts). These assertions pin the emitted schema
  // so a lenient runtime never comes at the cost of a vague contract.
  test("tools/list advertises precise argument schemas", async () => {
    const r = await sendRequest("github.ts", {
      jsonrpc: "2.0", id: 20, method: "tools/list", params: {},
    });
    const byName = new Map<string, any>(r.result.tools.map((t: { name: string }) => [t.name, t]));

    // `.int()` makes zod-to-json-schema emit "integer" rather than "number".
    const getIssue = byName.get("get_issue").inputSchema;
    expect(getIssue.properties.number.type).toBe("integer");
    expect(getIssue.required ?? []).not.toContain("number");

    // Mutations must keep `number` mandatory — no inferring an irreversible target.
    const closeIssue = byName.get("close_issue").inputSchema;
    expect(closeIssue.properties.number.type).toBe("integer");
    expect(closeIssue.required).toContain("number");

    // `labels` stays an array in the contract even though a bare string parses.
    const listIssues = byName.get("list_issues").inputSchema;
    expect(listIssues.properties.labels.type).toBe("array");
    expect(listIssues.properties.labels.items.type).toBe("string");
    expect(listIssues.properties.limit.type).toBe("integer");
  });

  test("get_issue accepts a stringified number", async () => {
    const r = await sendRequest(
      "github.ts",
      {
        jsonrpc: "2.0", id: 21, method: "tools/call",
        params: { name: "get_issue", arguments: { number: "185" } },
      },
      {
        ...fakeGhSeam(),
        FAKE_GH_RESPONSES: JSON.stringify([
          { match: ["issue", "view", "185"], stdout: JSON.stringify({ number: 185, title: "Coerced" }) },
        ]),
      },
    );
    expect(r.result.isError).toBe(false);
    expect(JSON.parse(r.result.content[0].text)).toMatchObject({ number: 185 });
  });

  test("get_issue falls back to the run's issue when number is omitted", async () => {
    const r = await sendRequest(
      "github.ts",
      {
        jsonrpc: "2.0", id: 22, method: "tools/call",
        params: { name: "get_issue", arguments: {} },
      },
      {
        ISSUE_NUMBER: "42",
        ...fakeGhSeam(),
        FAKE_GH_RESPONSES: JSON.stringify([
          { match: ["issue", "view", "42"], stdout: JSON.stringify({ number: 42, title: "From context" }) },
        ]),
      },
    );
    expect(r.result.isError).toBe(false);
    expect(JSON.parse(r.result.content[0].text)).toMatchObject({ number: 42 });
  });

  test("close_issue still refuses an omitted number", async () => {
    const r = await sendRequest(
      "github.ts",
      {
        jsonrpc: "2.0", id: 23, method: "tools/call",
        params: { name: "close_issue", arguments: {} },
      },
      { ISSUE_NUMBER: "42" },
    );
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("Invalid arguments for close_issue");
  });

  test("list_issues accepts a bare string for labels", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-list-issues-labels-"));
    const log = join(dir, "gh.log");
    try {
      const r = await sendRequest(
        "github.ts",
        {
          jsonrpc: "2.0", id: 24, method: "tools/call",
          params: { name: "list_issues", arguments: { labels: "atomaton/sub-issue", limit: "5" } },
        },
        {
          ...fakeGhSeam(),
          FAKE_GH_LOG: log,
          FAKE_GH_RESPONSES: JSON.stringify([{ match: ["issue", "list"], stdout: "[]" }]),
        },
      );
      expect(r.result.isError).toBe(false);
      const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      const issueList = calls[0] ?? [];
      expect(issueList).toContain("--label");
      expect(issueList).toContain("atomaton/sub-issue");
      // The stringified limit passed validation and reached `gh` as 5.
      expect(issueList[issueList.indexOf("--limit") + 1]).toBe("5");
    } finally {
      removeTemp(dir);
    }
  });
});

describe("mcp/shell.ts", () => {
  test("executes a foreground command and returns its output", async () => {
    const response = await sendRequest("shell.ts", {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "shell_execute", arguments: { command: "printf hello", timeout_seconds: 5 } },
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result).toMatchObject({ status: "completed", exit_code: 0, stdout: "hello", stderr: "" });
  });

  // The output goes into the session on the `atomaton-data` branch and can be
  // quoted into an issue comment, neither of which GitHub Actions masks. So it
  // has to leave this process already redacted.
  test("keeps a credential in its output from reaching the caller", async () => {
    const response = await sendRequest(
      "shell.ts",
      {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: {
          name: "shell_execute",
          arguments: { command: 'printf "key=$OPENAI_API_KEY shape=ghp_abcdefghijklmnopqrstuvwx"', timeout_seconds: 5 },
        },
      },
      { OPENAI_API_KEY: "sekrit-value-from-the-environment" },
    );
    const result = JSON.parse(response.result.content[0].text);
    expect(result.stdout).toBe("key=[redacted] shape=[redacted]");
  });

  test("terminates commands that exceed their timeout", async () => {
    const response = await sendRequest("shell.ts", {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "shell_execute", arguments: { command: "sleep 2", timeout_seconds: 1 } },
    });
    const result = JSON.parse(response.result.content[0].text);
    expect(result.status).toBe("timeout");
  });
});

describe("mcp/atomaton.ts", () => {
  test("initialize returns server info", async () => {
    const r = await sendRequest("atomaton.ts", {
      jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS,
    });
    expect(r.result.serverInfo.name).toBe("atomaton-mcp-server");
  });

  test("launch_sub_agent schema requires issue and agent", async () => {
    const r = await sendRequest("atomaton.ts", {
      jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
    });
    const tool = r.result.tools.find((t: { name: string }) => t.name === "launch_sub_agent");
    expect(tool.inputSchema.required).toEqual(["tasks"]);
    const item = tool.inputSchema.properties.tasks.items;
    expect(item.properties).toHaveProperty("issue");
    expect(item.properties).toHaveProperty("agent");
  });

  test("launch_sub_agent rejects empty tasks", async () => {
    const r = await sendRequest("atomaton.ts", {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "launch_sub_agent", arguments: { tasks: [] } },
    });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("tasks must be a non-empty list");
  });
});

// The two servers that had no round-trip test at all.
//
// Worth having on its own, and worth having now in particular: `serveMcpServer`
// replaced five hand-written request handlers with one, and each of those had
// been dropping a different part of a tool's result. `web` is the only server
// whose tools return images, so it is the one place the newly-preserved `images`
// field is exercised -- and it was outside the covered set.
describe("mcp/web.ts", () => {
  test("initializes and advertises fetch", async () => {
    const init = await sendRequest("web.ts", INIT_REQUEST);
    expect(init.result.serverInfo.name).toBe("atomaton-web-mcp");

    const list = await sendRequest("web.ts", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("fetch");
  });

  // Not "returns something": returns an ERROR. Every failure here used to come
  // back as an ordinary result whose body happened to be one English sentence,
  // so a model summarising several fetched pages had no structural signal that
  // one of them was never read.
  test("an unreachable host is an error, not a result", async () => {
    const r = await sendRequest("web.ts", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "fetch", arguments: { url: "http://127.0.0.1:1/nothing" } },
    });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("127.0.0.1");
  });

  test("a misspelled argument is refused rather than dropped", async () => {
    const r = await sendRequest("web.ts", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "fetch", arguments: { url: "https://example.com", rawe: true } },
    });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("rawe");
  });

  // This server declares `env: {}` so that it holds no credentials. Accepting
  // any scheme `new URL()` parses made it a local-file read instead -- the
  // cheapest route to `/proc/<pid>/environ` of a server that DOES hold one, and
  // to the `http.extraheader` line `actions/checkout` writes into `.git/config`.
  // No shell command, no routing rule to go around.
  test("refuses a file:// URL, which would make this a local-file read", async () => {
    for (const url of [
      "file:///proc/1/environ",
      "file:///home/runner/work/repo/repo/.git/config",
      "data:text/plain,hello",
    ]) {
      const r = await sendRequest("web.ts", {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "fetch", arguments: { url } },
      });
      expect(r.result.isError, url).toBe(true);
      expect(r.result.content[0].text, url).toContain("http");
    }
  });
});

describe("mcp/files.ts", () => {
  /** A tree to work in, which is also the only place the server may reach. */
  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "atomaton-files-"));
    for (const [name, body] of Object.entries(files)) {
      const at = join(root, name);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, body);
    }
    return root;
  }

  function call(root: string, name: string, args: Record<string, unknown>) {
    return sendRequest(
      "files.ts",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      {},
      root,
    );
  }

  const NUMBERED = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");

  /**
   * The whole reason this server exists.
   *
   * A read that stops has to say where to start again. Without it an agent changes the
   * number it passed and tries once more -- measured, four reads of one file, because
   * `head: 760` and `head: 40` returned the same amount and nothing said why.
   */
  test("a truncated read names the offset to continue from", async () => {
    const root = fixture({ "big.txt": NUMBERED });
    const r = await call(root, "read", { path: "big.txt", offset: 5, limit: 10 });
    const text = r.result.content[0].text;
    expect(r.result.isError).toBe(false);
    expect(text).toContain("lines 5-14 of 40");
    expect(text).toContain("5\tline 5");
    expect(text).toContain("offset: 15");
  });

  test("a read that reaches the end says nothing about continuing", async () => {
    const root = fixture({ "small.txt": "one\ntwo\n" });
    const text = (await call(root, "read", { path: "small.txt" })).result.content[0].text;
    expect(text).toContain("lines 1-2 of 2");
    expect(text).not.toContain("offset:");
  });

  test("an offset past the end is an error, not an empty result", async () => {
    const root = fixture({ "small.txt": "one\n" });
    const r = await call(root, "read", { path: "small.txt", offset: 9 });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("past the end");
  });

  test("grep returns file and line, and says when it stopped early", async () => {
    const root = fixture({ "a.ts": "const x = 1;\nconst wanted = 2;\n", "b.md": "wanted\n" });
    const text = (await call(root, "grep", { pattern: "wanted", glob: "*.ts" })).result.content[0].text;
    expect(text).toContain("a.ts:2:");
    // `glob` kept the markdown file out, so its line is not here.
    expect(text).not.toContain("b.md");

    const capped = (await call(root, "grep", { pattern: "wanted", max_matches: 1 })).result.content[0].text;
    expect(capped).toContain("further lines");
  });

  test("a pattern that matches nothing says so rather than failing", async () => {
    const root = fixture({ "a.ts": "nothing here\n" });
    const r = await call(root, "grep", { pattern: "absent" });
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toContain("No match");
  });

  test("glob finds files by path and grep finds them by content", async () => {
    const root = fixture({ "src/one.ts": "alpha\n", "src/deep/two.ts": "beta\n", "notes.md": "alpha\n" });
    const text = (await call(root, "glob", { pattern: "src/**/*.ts" })).result.content[0].text;
    expect(text).toContain("src/one.ts");
    expect(text).toContain("src/deep/two.ts");
    expect(text).not.toContain("notes.md");
  });

  /**
   * Ambiguity is refused rather than resolved: a caller that meant the second one has
   * no way to say so, and an edit made to the wrong line is found much later than an
   * error.
   */
  test("edit refuses text that appears more than once", async () => {
    const root = fixture({ "a.ts": "let x = 1;\nlet x = 1;\n" });
    const r = await call(root, "edit", { path: "a.ts", old_string: "let x = 1;", new_string: "let y = 2;" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("appears 2 times");

    const all = await call(root, "edit", {
      path: "a.ts", old_string: "let x = 1;", new_string: "let y = 2;", replace_all: true,
    });
    expect(all.result.isError).toBe(false);
    expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("let y = 2;\nlet y = 2;\n");
  });

  test("edit refuses text that is not there", async () => {
    const root = fixture({ "a.ts": "let x = 1;\n" });
    const r = await call(root, "edit", { path: "a.ts", old_string: "absent", new_string: "x" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("not in");
  });

  test("write creates the directories above the file", async () => {
    const root = fixture({});
    const r = await call(root, "write", { path: "a/b/c.txt", content: "made" });
    expect(r.result.isError).toBe(false);
    expect(readFileSync(join(root, "a/b/c.txt"), "utf8")).toBe("made");
  });

  /**
   * The containment the official server gave by being handed one directory. `../`
   * resolves before the comparison, so walking out is refused rather than followed.
   */
  test("a path outside the roots is refused and says what is allowed", async () => {
    const root = fixture({ "a.ts": "x\n" });
    const r = await call(root, "read", { path: "../../../etc/passwd" });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("outside the directories");
  });
});

describe("mcp/search.ts", () => {
  /**
   * This server used to be the one with no test at all.
   *
   * It imported `@huggingface/transformers` at module scope, so starting it cost the
   * import before it answered anything: the suite went from 42s to 3m28s and still
   * timed out. The note that stood here said to delete it if the import ever became
   * lazy. It has -- `loadRerankerOnce` imports the package when a search actually
   * reranks -- and starting the server now takes about a second.
   *
   * What this covers is that it starts and advertises what it should. Its own logic,
   * ranking and chunk selection, is pure and tested in `domain/bm25.ts`.
   */
  test("starts without loading the reranker, and advertises both searches", async () => {
    const r = await sendRequest("search.ts", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("search_code");
    expect(names).toContain("search_issues");
  });
});

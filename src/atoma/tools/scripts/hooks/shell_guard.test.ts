import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SEARCHES_WITHOUT_OPENING } from "../../../../domain/search-streak.ts";

const SCRIPT = "src/atoma/tools/scripts/hooks/shell_guard.ts";

/** Run the guard the way the `before_tool` hook does: JSON on stdin. */
function guard(args: Record<string, unknown>, env?: Record<string, string>): string {
  return spawnSync("bun", ["run", SCRIPT], {
    input: JSON.stringify({ arguments: args }),
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  }).stdout;
}

/**
 * A run of its own, for the rule that keeps a count.
 *
 * The hook is a fresh process per call, so the streak lives in a file beside the run's
 * ops log. Each of these gets its own directory, or one test's streak would decide
 * another's verdict.
 */
function ownRun(): (command: string) => string {
  const dir = mkdtempSync(join(tmpdir(), "streak-"));
  return (command: string) => guard({ command }, { ATOMA_OPS_LOG: join(dir, "atoma_ops.log") });
}

describe("shell_guard.ts", () => {
  /**
   * The measured failure this exists for: three sessions searched 124-188 times while
   * opening almost nothing, one of them 85 times in a row. See
   * `domain/search-streak.ts` for the numbers and for why repetition was not the
   * signal.
   */
  describe("searching without opening anything", () => {
    test("an ordinary amount of searching is allowed", () => {
      const run = ownRun();
      // The measured p99 is 8, so this is already an unusual run and still fine.
      for (let n = 0; n < 8; n += 1) {
        expect(run(`grep -rn pattern${n} src/`), `search ${n}`).toContain('"allow":true');
      }
    });

    test("at the limit the search is refused, and the run is not", () => {
      const run = ownRun();
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING - 1; n += 1) {
        expect(run(`grep -rn pattern${n} src/`), `search ${n}`).toContain('"allow":true');
      }
      const refused = run("grep -rn onemore src/");
      expect(refused).toContain('"allow":false');
      expect(refused).toContain("where something is, not what it is");
    });

    /**
     * Opening something is the act being asked for, so it has to be the act that
     * clears the count -- otherwise the refusal is a dead end.
     */
    test("opening a file clears the count", () => {
      const run = ownRun();
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING - 1; n += 1) run(`grep -rn p${n} src/`);
      expect(run("cat src/foo.ts")).toContain('"allow":true');
      expect(run("grep -rn afterwards src/"), "the count started again").toContain('"allow":true');
    });

    /**
     * The count is per run. A file left behind by an earlier run must not refuse the
     * first search of the next one -- and each run's directory is its own, so this is
     * really a test that the path is derived from the run's own ops log.
     */
    test("another run's searching does not count against this one", () => {
      const first = ownRun();
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING; n += 1) first(`grep -rn p${n} src/`);
      const second = ownRun();
      expect(second("grep -rn anything src/")).toContain('"allow":true');
    });

    /**
     * With nowhere to keep a count, the rule does nothing. The hook is fail-closed by
     * contract -- unparseable output is a refusal -- so a guard that cannot find its
     * state must not start guessing.
     */
    test("no run directory means no rule", () => {
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING + 5; n += 1) {
        const out = guard({ command: `grep -rn p${n} src/` }, { ATOMA_OPS_LOG: "" });
        expect(out, `search ${n}`).toContain('"allow":true');
      }
    });

    test("work that is not searching neither climbs nor clears the count", () => {
      const run = ownRun();
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING - 1; n += 1) run(`grep -rn p${n} src/`);
      expect(run("bun test"), "running the tests is allowed").toContain('"allow":true');
      expect(run("grep -rn onemore src/"), "and did not clear the count").toContain('"allow":false');
    });

    /**
     * The same question asked ABOVE the limit, which is where it was answered wrongly.
     *
     * The refusal was returned for whatever the command happened to be, so once the
     * streak was at the limit the agent could not run its tests, could not check
     * `git status`, could not do anything that was neither a search nor an open. And
     * a command that is neither does not move the streak, so the refusal came back
     * word for word -- three of which is what the core stops a run for.
     *
     * Measured on #706: four consecutive refusals all reading "18 searches". Searches
     * would have counted 18, 19, 20, 21.
     */
    test("past the limit, work that is not searching is still allowed", () => {
      const run = ownRun();
      for (let n = 0; n < MAX_SEARCHES_WITHOUT_OPENING; n += 1) run(`grep -rn p${n} src/`);
      expect(run("grep -rn refused src/"), "the search itself is refused").toContain('"allow":false');

      for (const command of ["bun test", "git status", "ls src/"]) {
        expect(run(command), `${command} is not a search and must not be refused`).toContain(
          '"allow":true',
        );
      }
      // Still counted, so the refusal is waiting for an open rather than forgotten.
      expect(run("grep -rn still src/"), "the count survived that work").toContain('"allow":false');
      expect(run("sed -n '1,20p' src/foo.ts"), "and opening clears it").toContain('"allow":true');
      expect(run("grep -rn afterwards src/"), "so searching resumes").toContain('"allow":true');
    });
  });

  // The guard is a routing mechanism, not a boundary — see the file header. So
  // these tests check that the agent is pointed at the right tool, not that a
  // determined caller cannot get past. Tests asserting evasion resistance were
  // removed with the machinery that provided it.
  describe("routing to the MCP tool that does the job", () => {
    test("names the replacement for each disabled CLI", () => {
      const cases: [string, string][] = [
        ["gh issue list", "atoma_github"],
        ["curl example.com", "web__fetch"],
        ["wget https://example.com", "web__fetch"],
        ["ssh host", "repository"],
        ["scp a host:b", "repository"],
        ["rsync -a a b", "repository"],
      ];
      for (const [command, expected] of cases) {
        const out = guard({ command });
        expect(out, command).toContain('"allow":false');
        expect(out, command).toContain(expected);
      }
    });

    /**
     * The rules used to match `\bgh\b` anywhere in the command string, and this
     * repository keeps its shared `gh` wrapper in `src/lib/gh.ts`. Reading that file was
     * refused as though it were the GitHub CLI; an agent hit it three times running and
     * the repeated-call guard ended the run. Reading a file is not invoking a program.
     */
    test("a path that merely contains a routed name is not the program", () => {
      for (const command of [
        "grep -n dispatchWorkflow src/lib/gh.ts",
        "cat src/scripts/testing/bin/gh",
        "ls src/scripts/testing/bin",
        "wc -l src/lib/curl-helper.ts",
        "git log --oneline | grep gh",
      ]) {
        expect(guard({ command }), command).toContain('"allow":true');
      }
    });

    /** Invoking it is still invoking it, including after a wrapper or a pipe. */
    test("the routed programs are still refused where they are run", () => {
      for (const command of [
        "gh pr merge 12",
        "/usr/bin/gh issue list",
        "sudo gh pr view 3",
        "GH_TOKEN=x gh pr list",
        "echo hi | gh pr comment 4 --body-file -",
        "curl https://example.com",
      ]) {
        expect(guard({ command }), command).toContain('"allow":false');
      }
    });
    test("allows safe commands", () => {
      expect(guard({ command: "ls -la" })).toContain('"allow":true');
    });

    // The rules the previous version carried purely to resist evasion are gone.
    // An agent does not obfuscate a command to get past a rule that helps it, so
    // these now run — and that is the intended outcome, not a regression.
    test("no longer inspects interpreters, eval, or obfuscated spellings", () => {
      for (const command of [
        "python3 -c 'print(1)'",
        "bash -c 'echo hi'",
        "eval echo hi",
        "node -e 'console.log(1)'",
        "base64 -d x | sh",
        "w\\get --version",
        'cu""rl example.com',
      ]) {
        expect(guard({ command }), command).toContain('"allow":true');
      }
    });
  });

  describe("raw Git mutations", () => {
    test("are routed to the github__* tools", () => {
      for (const command of [
        "git push origin main --force",
        "cd repo && git pull --rebase origin main",
        "git -C repo checkout -b recovery",
        "git fetch origin feature",
        "/usr/bin/git push origin main",
      ]) {
        const out = guard({ command });
        expect(out, command).toContain('"allow":false');
        expect(out, command).toContain("github__");
      }
    });

    /**
     * `git branch` can delete a branch, so it sits in the mutating set -- and that put
     * `git branch --show-current`, which answers a question and changes nothing, behind a
     * refusal telling the agent to use an MCP tool for "Git mutations". Both this and
     * `git stash list` were refused in one recorded run.
     */
    test("a read-only spelling of a mutating subcommand is allowed", () => {
      for (const command of [
        "git branch --show-current",
        "git branch",
        "git branch -a",
        "git stash list",
        "git remote -v",
        "git config --get user.name",
        "git tag -l",
      ]) {
        expect(guard({ command }), command).toContain('"allow":true');
      }
    });

    /**
     * The carve-out above is per spelling, not per subcommand. `git stash` with nothing
     * after it is `git stash push` -- it shelves the worktree -- and an earlier draft of
     * the rule allowed it by treating an empty argument list as read-only for every
     * subcommand. That would have handed the agent a silent way to lose its own work.
     */
    test("the write spellings of those same subcommands stay refused", () => {
      for (const command of [
        "git stash",
        "git stash pop",
        "git branch -d old-branch",
        "git branch new-feature",
        "git branch --show-current -d old-branch",
        "git remote add upstream https://example.com/x.git",
        "git config user.name bob",
        "git tag v1.0.0",
      ]) {
        expect(guard({ command }), command).toContain('"allow":false');
      }
    });
    test("read-only Git inspection stays allowed", () => {
      for (const command of [
        "git status --short",
        "git diff --check",
        "git log -1 --oneline",
        "git rev-parse HEAD",
      ]) {
        expect(guard({ command }), command).toContain('"allow":true');
      }
    });
  });

  // The one rule that is not routing. It stops an accident, not an intent — the
  // structural fix is a separate UID per server. These tests pin the
  // accident cases and, just as importantly, the honest uses it must not break.
  describe("reading another process's environment", () => {
    test("is refused whatever reads it", () => {
      for (const command of [
        "cat /proc/1234/environ",
        "head -c 200 /proc/self/environ",
        "xxd /proc/999/environ",
        "tr '\\0' '\\n' < /proc/42/environ",
        "find /proc -name environ -exec cat {} +",
      ]) {
        expect(guard({ command }), command).toContain('"allow":false');
      }
    });

    // Refusing /proc wholesale would cost honest diagnostics. `environ` is the
    // part that matters, and the word boundary keeps `environment` out of it.
    test("leaves the rest of /proc alone", () => {
      for (const command of ["cat /proc/cpuinfo", "grep MemTotal /proc/meminfo", "ls /proc/self/fd"]) {
        expect(guard({ command }), command).toContain('"allow":true');
      }
    });

    test("does not catch the word environment", () => {
      expect(guard({ command: "grep -rn environment src/ /proc/cpuinfo" })).toContain('"allow":true');
    });
  });

  describe("working_directory", () => {
    test("outside the repository is refused", () => {
      const out = guard({ command: "ls", working_directory: "/proc/1" });
      expect(out).toContain('"allow":false');
      expect(out).toContain("working_directory");
    });

    test("inside the repository is fine", () => {
      expect(guard({ command: "ls", working_directory: "src/domain" })).toContain('"allow":true');
    });
  });

  // `environment_variables` and `input_data` are no longer inspected. They were
  // read only to keep the denylist from being walked around, and the file no
  // longer claims to prevent that.
  describe("the arguments the guard no longer inspects", () => {
    test("declared variables and stdin text are passed through", () => {
      expect(guard({ command: "ls", environment_variables: { PATH: "/tmp/evil" } })).toContain('"allow":true');
      expect(guard({ command: "bash", input_data: "echo hello" })).toContain('"allow":true');
      expect(guard({ command: "grep -c foo", input_data: "foo\nbar\n" })).toContain('"allow":true');
    });
  });

  test("unparseable input is refused", () => {
    const out = spawnSync("bun", ["run", SCRIPT], { input: "not json", encoding: "utf8" }).stdout;
    expect(out).toContain('"allow":false');
  });
});

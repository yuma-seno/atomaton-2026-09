import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubOutput, runWithFakeGh, scriptPath, type FakeGhRule } from "./testing/harness.ts";
import { isBranchName, prHead } from "./resolve_pr_branch.ts";

/**
 * The branch a `pr` run may push to.
 *
 * A pull request run checks `refs/pull/N/head` out, which git leaves DETACHED --
 * `git rev-parse --abbrev-ref HEAD` answers `HEAD` -- so `commit_and_push` built a
 * refspec out of git's description of that state and died on
 * `fatal: invalid refspec '(HEAD detached at pull/802/head)'`. The one agent whose
 * job is to push a fix onto a red pull request was the one that could not (#247,
 * #803).
 *
 * What this script must never do is hand back `HEAD`, an empty string, or a
 * branch of this repository that the pull request is not from -- and what it must
 * never do either is fail the run, because a run that stops before the agent has
 * said anything is worse than one that reports it could not publish.
 */
describe("resolve_pr_branch.ts", () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }

  /**
   * A real remote, because `existsOnOrigin` asks git and not a fake: the whole
   * question is whether `origin` has the branch, and a stubbed git would only
   * assert this file's idea of that.
   */
  function makeRemote(branches: string[]): { root: string; work: string } {
    const root = mkdtempSync(join(tmpdir(), "atomaton-pr-branch-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    git(root, "init", "--bare", "--initial-branch=main", remote);
    git(root, "init", "--initial-branch=main", seed);
    git(seed, "config", "user.name", "Atomaton Test");
    git(seed, "config", "user.email", "atomaton@example.com");
    writeFileSync(join(seed, "value.txt"), "one\n");
    git(seed, "add", "value.txt");
    git(seed, "commit", "-m", "initial");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    for (const branch of branches) {
      if (branch === "main") continue;
      git(seed, "branch", branch);
      git(seed, "push", "origin", branch);
    }
    const work = join(root, "work");
    git(root, "clone", remote, work);
    return { root, work };
  }

  /** What `gh pr view --json headRefName,isCrossRepository` prints for a head branch. */
  function headRule(headRefName: string, isCrossRepository = false): FakeGhRule {
    return {
      match: ["pr", "view"],
      stdout: JSON.stringify({ headRefName, isCrossRepository }),
    };
  }

  /** Run the script the way the workflow step does, and report its output file and streams. */
  function run(
    rules: FakeGhRule[],
    args = ["--repo", "owner/repo", "--number", "9"],
    cwd = process.cwd(),
  ): { status: number | null; stdout: string; stderr: string; branch: string } {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-pr-branch-out-"));
    const output = join(dir, "out");
    writeFileSync(output, "");
    try {
      const r = runWithFakeGh(scriptPath("resolve_pr_branch.ts"), args, {
        rules,
        env: { GITHUB_OUTPUT: output },
        cwd,
      });
      return { ...r, branch: parseGithubOutput(readFileSync(output, "utf8")).branch ?? "" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("names the pull request's head branch when this repository has it", () => {
    const { root, work } = makeRemote(["atomaton/issue-9"]);
    try {
      const r = run([headRule("atomaton/issue-9")], undefined, work);
      expect(r.status).toBe(0);
      expect(r.branch).toBe("atomaton/issue-9");
      expect(r.stderr).toContain("the pull request's head branch is atomaton/issue-9");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The defect, exactly: the step this replaces wrote git's own answer for a
   * detached checkout -- `HEAD` -- into `BRANCH`. `HEAD` is not a branch, and
   * `git check-ref-format --branch` is where that is decided rather than in a
   * pattern here.
   */
  test("a head branch of HEAD is refused rather than passed on", () => {
    const { root, work } = makeRemote(["main"]);
    try {
      const r = run([headRule("HEAD")], undefined, work);
      expect(r.status).toBe(0);
      expect(r.branch).toBe("");
      expect(r.stderr).toContain("which is not a branch name");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * A fork's head branch is a branch of the FORK. Resolving it against this
   * repository would check out a branch of the same name here -- `main`, for a
   * fork whose branch is called that -- and the run's push would land on this
   * repository's own branch.
   */
  test("a fork's head branch is refused, even when a branch of that name exists here", () => {
    const { root, work } = makeRemote(["main"]);
    try {
      const r = run([headRule("main", true)], undefined, work);
      expect(r.status).toBe(0);
      expect(r.branch).toBe("");
      expect(r.stderr).toContain("comes from a fork");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a head branch this repository does not have is refused", () => {
    const { root, work } = makeRemote(["atomaton/issue-9"]);
    try {
      const r = run([headRule("atomaton/issue-404")], undefined, work);
      expect(r.status).toBe(0);
      expect(r.branch).toBe("");
      expect(r.stderr).toContain("does not exist on origin");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a failed read is no branch, not a failed run", () => {
    const r = run([{ match: ["pr", "view"], code: 1, stdout: "gh: not found" }]);
    expect(r.status).toBe(0);
    expect(r.branch).toBe("");
    expect(r.stderr).toContain("could not read pull request #9");
  });

  test("output that is not the JSON asked for is no branch either", () => {
    const r = run([{ match: ["pr", "view"], stdout: "not json" }]);
    expect(r.status).toBe(0);
    expect(r.branch).toBe("");
    expect(r.stderr).toContain("names no head branch");
  });

  /** Without the number there is no pull request to ask about, and no branch to name. */
  test("missing arguments resolve to no branch and still exit 0", () => {
    const r = run([], ["--repo", "owner/repo"]);
    expect(r.status).toBe(0);
    expect(r.branch).toBe("");
    expect(r.stderr).toContain("missing --repo or --number");
  });

  test("prHead reads the head branch and the fork flag", () => {
    expect(prHead('{"headRefName":"atomaton/issue-9","isCrossRepository":false}')).toEqual({
      branch: "atomaton/issue-9",
      crossRepository: false,
    });
    expect(prHead('{"headRefName":" main ","isCrossRepository":true}')).toEqual({
      branch: "main",
      crossRepository: true,
    });
    // Absent, null and malformed all mean the same thing here: nothing to name.
    expect(prHead("{}").branch).toBe("");
    expect(prHead('{"headRefName":null}').branch).toBe("");
    expect(prHead("[").branch).toBe("");
  });

  test("isBranchName is git's rule, not a pattern of our own", () => {
    expect(isBranchName("atomaton/issue-9")).toBe(true);
    expect(isBranchName("feature/x-1.2")).toBe(true);
    for (const bad of ["", "HEAD", "has space", "a..b", "x.lock", "-x", "a:b", "x~y", "x^y"]) {
      expect(isBranchName(bad), `${bad} must not be usable as a branch`).toBe(false);
    }
  });
});

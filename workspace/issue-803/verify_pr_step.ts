#!/usr/bin/env bun
/**
 * Exercises the generated `pr`-run steps against a real repository, and measures
 * the alternative the issue proposed (`git checkout -B <branch> "$GITHUB_SHA"`).
 *
 * Not a test in the repository -- a one-off measurement for this change's PR.
 * It builds a remote with a branch, checks `refs/pull/9/head` out DETACHED the way
 * `actions/checkout` does (shallow, into `refs/remotes/pull/9/head`), then runs the
 * two generated steps' shell verbatim and asks `resolveBranch()` what branch this
 * run is on, before and after. Then it does the same in a second clone with
 * `$GITHUB_SHA` in place of HEAD, with GITHUB_SHA set to what a `gh workflow run`
 * with no `--ref` sets it to: the default branch's tip.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "/home/runner/work/atomaton/atomaton";

function sh(cwd: string, cmd: string): { out: string; code: number } {
  try {
    return { out: execFileSync("bash", ["-c", cmd], { cwd, encoding: "utf8" }).trim(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim(), code: 1 };
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "verify-pr-step-"));
const remote = join(root, "remote.git");
const seed = join(root, "seed");

git(root, "init", "--bare", "--initial-branch=main", remote);
git(root, "init", "--initial-branch=main", seed);
git(seed, "config", "user.name", "t");
git(seed, "config", "user.email", "t@example.com");
writeFileSync(join(seed, "a.txt"), "base\n");
git(seed, "add", "a.txt");
git(seed, "commit", "-m", "base");
git(seed, "remote", "add", "origin", remote);
git(seed, "push", "-u", "origin", "main");
git(seed, "checkout", "-b", "atomaton/issue-9");
writeFileSync(join(seed, "a.txt"), "the pull request's own commit\n");
git(seed, "add", "a.txt");
git(seed, "commit", "-m", "the pull request");
git(seed, "push", "origin", "atomaton/issue-9");
// A later commit on the default branch, so GITHUB_SHA (the dispatch ref's tip)
// and the pull request head are genuinely different commits.
git(seed, "checkout", "main");
writeFileSync(join(seed, "b.txt"), "landed after the pull request\n");
git(seed, "add", "b.txt");
git(seed, "commit", "-m", "default branch moved on");
git(seed, "push", "origin", "main");
const defaultTip = git(seed, "rev-parse", "main");
const prHead = git(seed, "rev-parse", "atomaton/issue-9");

/**
 * A clone at the pull request's head, detached, exactly as `actions/checkout`
 * leaves it: fetched shallow into `refs/remotes/pull/9/head`, then checked out.
 */
function prRunCheckout(name: string): string {
  const work = join(root, name);
  git(root, "clone", "--no-checkout", remote, work);
  git(work, "fetch", "--depth=1", "origin", "+refs/heads/atomaton/issue-9:refs/remotes/pull/9/head");
  git(work, "checkout", "--detach", "refs/remotes/pull/9/head");
  git(work, "config", "user.name", "t");
  git(work, "config", "user.email", "t@example.com");
  return work;
}

function resolveBranchIn(cwd: string, env: Record<string, string>): string {
  const out = execFileSync("bun", ["-e", `
    import { resolveBranch } from "${REPO}/src/lib/branch-placement.ts";
    try { console.log(JSON.stringify({ ok: resolveBranch() })); }
    catch (e) { console.log(JSON.stringify({ error: e.message })); }
  `], { cwd, encoding: "utf8", env: { ...process.env, ...env } }).trim();
  return out;
}

/** The generated step's shell verbatim, with the start point as its only variable. */
function stepShell(branch: string, envFile: string, startPoint: string): string {
  return `if [ -z "${branch}" ]; then
  echo "no pull request head branch to check out; this run stays on the detached checkout"
  exit 0
fi
if ! git fetch origin "refs/heads/${branch}:refs/remotes/origin/${branch}"; then
  echo "::warning::could not fetch ${branch} from origin; this run stays on the detached checkout"
  exit 0
fi
if ! git checkout -B "${branch}" ${startPoint}; then
  echo "::warning::could not check out ${branch}; this run stays on the detached checkout"
  exit 0
fi
echo "BRANCH=${branch}" >> ${envFile}
echo "on the pull request's head branch: ${branch}"`;
}

const BRANCH_NAME = "atomaton/issue-9";

// ── The fix as generated: `git checkout -B <branch> HEAD` ─────────────────────
const work = prRunCheckout("work");
const before = {
  head: git(work, "rev-parse", "HEAD"),
  abbrev: git(work, "rev-parse", "--abbrev-ref", "HEAD"),
  pointsAt: git(work, "branch", "--format=%(refname:short)", "--points-at=HEAD"),
};
const beforeResolve = resolveBranchIn(work, { BRANCH: "HEAD" });
const envFile = join(root, "github_env");
writeFileSync(envFile, "");
const stepOut = sh(work, stepShell(BRANCH_NAME, envFile, "HEAD")).out;
const branchFromEnv = readFileSync(envFile, "utf8").trim().replace(/^BRANCH=/, "");
const afterResolve = resolveBranchIn(work, { BRANCH: branchFromEnv });

const fix = {
  prHead,
  defaultTip,
  "before.head": before.head,
  "before.abbrev": before.abbrev,
  "before.pointsAt": before.pointsAt,
  "before.resolveBranch": JSON.parse(beforeResolve),
  stepOut,
  github_env: readFileSync(envFile, "utf8").trim(),
  "after.currentBranch": git(work, "branch", "--show-current"),
  "after.resolveBranch": JSON.parse(afterResolve),
  headUnchanged: before.head === git(work, "rev-parse", "HEAD"),
  headIsPrHead: git(work, "rev-parse", "HEAD") === prHead,
  headIsNotDefaultTip: git(work, "rev-parse", "HEAD") !== defaultTip,
  statusClean: git(work, "status", "--porcelain") === "",
  "a.txt": readFileSync(join(work, "a.txt"), "utf8").trim(),
};

// ── The alternative the issue proposed: `$GITHUB_SHA` ─────────────────────────
// A clone that holds only the pull request's head, which is what `actions/checkout`
// with the default `fetch-depth: 1` leaves for `refs/pull/N/head`.
const work2 = join(root, "work2");
git(root, "init", "--initial-branch=main", work2);
git(work2, "remote", "add", "origin", remote);
git(work2, "fetch", "--depth=1", "origin", "+refs/heads/atomaton/issue-9:refs/remotes/pull/9/head");
git(work2, "checkout", "--detach", "refs/remotes/pull/9/head");
git(work2, "config", "user.name", "t");
git(work2, "config", "user.email", "t@example.com");
// What `gh workflow run` with no `--ref` sets GITHUB_SHA to: the default branch's tip.
const shaPresent = sh(work2, `git cat-file -e ${defaultTip}`).code === 0;
const envFile2 = join(root, "github_env2");
writeFileSync(envFile2, "");
const shaStep = sh(work2, stepShell(BRANCH_NAME, envFile2, `"${defaultTip}"`));
const alt = {
  githubShaIsDefaultTip: defaultTip,
  "githubShaPresentInAPrOnlyCheckout": shaPresent,
  stepOut: shaStep.out.split("\n").slice(-3).join(" | "),
  stepExitedNonZero: shaStep.code !== 0,
  github_env: readFileSync(envFile2, "utf8").trim(),
  "headAfter": git(work2, "rev-parse", "HEAD"),
  "currentBranchAfter": git(work2, "branch", "--show-current"),
  "headMovedOffThePullRequest": git(work2, "rev-parse", "HEAD") !== prHead,
  "resolveBranchAfter": JSON.parse(resolveBranchIn(work2, { BRANCH: branchFromEnv })),
};

console.log(JSON.stringify({ fix, alternativeUsingGithubSha: alt }, null, 2));
rmSync(root, { recursive: true, force: true });

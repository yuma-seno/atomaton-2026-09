import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function mk(root: string, name: string): string {
  const repo = join(root, name);
  git(root, "init", "--initial-branch=main", repo);
  git(repo, "config", "user.email", "a@b.c");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "f.txt"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "one");
  return repo;
}

function describe(repo: string, label: string) {
  const out = git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD");
  console.log(label, JSON.stringify(out));
}

const root = mkdtempSync(join(tmpdir(), "probe4-"));

// A: remote-tracking ref under refs/remotes/pull/802/head
{
  const repo = mk(root, "a");
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/pull/802/head", sha);
  git(repo, "checkout", "--detach", "refs/remotes/pull/802/head");
  describe(repo, "A checkout --detach refs/remotes/pull/802/head:");
  git(repo, "branch", "-D", "main");
  describe(repo, "A after deleting main:");
}

// B: fetch refs/pull/802/head from a bare remote, then checkout --detach
{
  const repo = mk(root, "b");
  const bare = join(root, "b.git");
  git(root, "init", "--bare", bare);
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "HEAD:refs/pull/802/head");
  git(repo, "fetch", "-q", "origin", "refs/pull/802/head");
  git(repo, "checkout", "--detach", "FETCH_HEAD");
  describe(repo, "B checkout --detach FETCH_HEAD:");
  git(repo, "branch", "-D", "main");
  describe(repo, "B after deleting main:");
}

// C: fetch with an explicit remote-tracking destination, then checkout that
{
  const repo = mk(root, "c");
  const bare = join(root, "c.git");
  git(root, "init", "--bare", bare);
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "HEAD:refs/pull/802/head");
  git(repo, "fetch", "-q", "origin", "refs/pull/802/head:refs/remotes/pull/802/head");
  git(repo, "checkout", "--detach", "refs/remotes/pull/802/head");
  describe(repo, "C fetch to refs/remotes/pull/802/head then detach:");
  git(repo, "branch", "-D", "main");
  describe(repo, "C after deleting main:");
}

// D: what does show-ref / rev-parse do on the pseudo-entry
{
  const repo = mk(root, "d");
  git(repo, "branch", "-D", "main");
  git(repo, "checkout", "--detach", "HEAD");
  describe(repo, "D detached, no branches:");
  console.log("D symbolic-ref HEAD:", (() => { try { return git(repo, "symbolic-ref", "-q", "HEAD"); } catch (e: any) { return "exit " + e.status; } })());
}

rmSync(root, { recursive: true, force: true });

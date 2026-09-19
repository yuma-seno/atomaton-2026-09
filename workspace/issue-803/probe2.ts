import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "probe2-"));
const repo = join(root, "repo");
git(root, "init", "--initial-branch=main", repo);
git(repo, "config", "user.email", "a@b.c");
git(repo, "config", "user.name", "t");
writeFileSync(join(repo, "f.txt"), "one\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "one");
const sha = git(repo, "rev-parse", "HEAD");

// variant A: update-ref refs/pull/802/head then checkout --detach that ref
git(repo, "update-ref", "refs/pull/802/head", sha);
git(repo, "checkout", "--detach", "refs/pull/802/head");
console.log("A points-at:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("A HEAD file:", JSON.stringify(git(repo, "rev-parse", "HEAD")));

// variant B: plain detach at sha with a remote-tracking ref at that sha
git(repo, "update-ref", "refs/remotes/origin/atomaton/issue-1", sha);
git(repo, "checkout", "--detach", sha);
console.log("B points-at:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));

// variant C: detach at sha after having a local branch at that sha, then delete branch
git(repo, "branch", "tmpbr");
git(repo, "branch", "-D", "tmpbr");
console.log("C points-at:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));

console.log("rev-parse --abbrev-ref HEAD:", JSON.stringify(git(repo, "rev-parse", "--abbrev-ref", "HEAD")));
console.log("show-ref --verify refs/heads/main:", (() => {
  try { execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/main"], { cwd: repo }); return "0"; } catch (e: any) { return String(e.status); }
})());
console.log("rev-parse --verify --quiet refs/heads/main:", (() => {
  try { execFileSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/main"], { cwd: repo }); return "0"; } catch (e: any) { return String(e.status); }
})());
console.log("rev-parse --verify --quiet refs/heads/nope:", (() => {
  try { execFileSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/nope"], { cwd: repo }); return "0"; } catch (e: any) { return String(e.status); }
})());
rmSync(root, { recursive: true, force: true });

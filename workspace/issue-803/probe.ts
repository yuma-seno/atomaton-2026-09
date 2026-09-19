import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "probe-"));
const repo = join(root, "repo");
git(root, "init", "--initial-branch=main", repo);
git(repo, "config", "user.email", "a@b.c");
git(repo, "config", "user.name", "t");
writeFileSync(join(repo, "f.txt"), "one\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "one");
git(repo, "branch", "atomaton/issue-1");
git(repo, "branch", "other");
git(repo, "checkout", "--detach", "HEAD");
console.log("points-at with branches:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("abbrev-ref:", JSON.stringify(git(repo, "rev-parse", "--abbrev-ref", "HEAD")));
console.log("show-current:", JSON.stringify(git(repo, "branch", "--show-current")));
git(repo, "branch", "-D", "other");
git(repo, "checkout", "--detach", "HEAD");
console.log("points-at one branch:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
// simulate no local branch at all: detach at a commit not pointed at by any branch
writeFileSync(join(repo, "g.txt"), "two\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "two");
const sha = git(repo, "rev-parse", "HEAD");
git(repo, "reset", "--hard", "HEAD~1");
git(repo, "checkout", "--detach", sha);
console.log("points-at none:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("show-ref verify atomaton/issue-1:", (() => {
  try { execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/atomaton/issue-1"], { cwd: repo }); return "0"; }
  catch (e: any) { return String(e.status); }
})());
console.log("show-ref verify bogus:", (() => {
  try { execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/(HEAD detached at pull/802/head)"], { cwd: repo }); return "0"; }
  catch (e: any) { return String(e.status); }
})());
rmSync(root, { recursive: true, force: true });

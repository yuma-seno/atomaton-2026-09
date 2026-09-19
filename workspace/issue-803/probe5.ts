import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "probe5-"));
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

git(work, "config", "user.name", "Atomaton Test");
git(work, "config", "user.email", "atomaton@example.com");
git(work, "checkout", "--detach", "HEAD");
git(work, "branch", "-D", "atomaton/issue-1");
console.log("points-at:", JSON.stringify(git(work, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("abbrev-ref:", JSON.stringify(git(work, "rev-parse", "--abbrev-ref", "HEAD")));
writeFileSync(join(work, "fix.txt"), "fix\n");
console.log("status:", JSON.stringify(git(work, "status", "--porcelain")));
console.log("head:", git(work, "rev-parse", "HEAD"));
console.log("show-ref verify:", (() => { try { git(work, "show-ref", "--verify", "--quiet", "refs/heads/atomaton/issue-1"); return "0"; } catch (e: any) { return String(e.status); } })());
rmSync(root, { recursive: true, force: true });

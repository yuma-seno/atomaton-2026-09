import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "probe3-"));
const repo = join(root, "repo");
git(root, "init", "--initial-branch=main", repo);
git(repo, "config", "user.email", "a@b.c");
git(repo, "config", "user.name", "t");
writeFileSync(join(repo, "f.txt"), "one\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "one");
const sha = git(repo, "rev-parse", "HEAD");

// ref named pull/802/head (DWIM expands to refs/pull/802/head)
git(repo, "update-ref", "refs/pull/802/head", sha);
git(repo, "checkout", "--detach", "pull/802/head");
console.log("HEAD desc:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("branch -a:", JSON.stringify(git(repo, "branch", "-a")));
console.log("symbolic-ref HEAD exit:", (() => { try { git(repo, "symbolic-ref", "-q", "HEAD"); return "0"; } catch (e: any) { return String(e.status); } })());
// delete main so no local branch at tip
git(repo, "checkout", "--detach", sha);
git(repo, "branch", "-D", "main");
console.log("no local branch points-at:", JSON.stringify(git(repo, "branch", "--format=%(refname:short)", "--points-at=HEAD")));
console.log("check-ref-format --branch '(HEAD detached at pull/802/head)':", (() => { try { git(repo, "check-ref-format", "--branch", "(HEAD detached at pull/802/head)"); return "0"; } catch (e: any) { return String(e.status); } })());
rmSync(root, { recursive: true, force: true });

#!/usr/bin/env bun
// @bun

// src/scripts/resolve_pr_branch.ts
import { appendFileSync } from "fs";
import { parseArgs } from "util";

// src/lib/gh.ts
function run(cmd) {
  const proc = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout ? proc.stdout.toString("utf8").trim() : "",
    stderr: proc.stderr ? proc.stderr.toString("utf8").trim() : ""
  };
}
function gh(...args) {
  return run(["gh", ...args]);
}
function gitRun(...args) {
  return run(["git", ...args]);
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";

// src/domain/machinery-layout.ts
var USER_ROOT = ".github/atomaton";
var RUNTIME_ROOT = ".github/atomaton-runtime";
var CONFIG_FILE = `${USER_ROOT}/config.yaml`;
var AGENT_DEFINITIONS_DIR = `${USER_ROOT}/agent-definitions`;
var PROMPT_TEMPLATE = `${USER_ROOT}/prompt-template.md`;
var SKILLS_DIR = `${USER_ROOT}/skills`;
var TOOLS_DIR = `${RUNTIME_ROOT}/tools`;
var TOOL_DEFAULTS_FILE = `${TOOLS_DIR}/defaults.yaml`;
var TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;
var TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;
var RULESETS_DIR = `${USER_ROOT}/rulesets`;
var SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;

// src/scripts/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/scripts/resolve_pr_branch.ts
var ref = defineScript(import.meta.url);
function log(message) {
  console.error(`[atomaton-pr-branch] ${message}`);
}
function prHead(prJson) {
  try {
    const pr = JSON.parse(prJson);
    return {
      branch: typeof pr.headRefName === "string" ? pr.headRefName.trim() : "",
      crossRepository: pr.isCrossRepository === true
    };
  } catch {
    return { branch: "", crossRepository: false };
  }
}
function isBranchName(name) {
  if (!name)
    return false;
  return gitRun("check-ref-format", "--branch", name).code === 0;
}
function existsOnOrigin(name) {
  const { code, stdout } = gitRun("ls-remote", "--heads", "origin", `refs/heads/${name}`);
  return code === 0 && stdout.trim() !== "";
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" }, number: { type: "string" } }
  });
  const repo = (values.repo ?? "").trim();
  const number = Number((values.number ?? "").trim());
  const githubOutput = process.env.GITHUB_OUTPUT;
  let branch = "";
  if (!repo || !Number.isInteger(number) || number <= 0) {
    log("missing --repo or --number; this run has no branch to check out");
  } else {
    const { code, stdout, stderr } = gh("pr", "view", String(number), "--repo", repo, "--json", "headRefName,isCrossRepository");
    if (code !== 0) {
      log(`could not read pull request #${number}: ${stderr || stdout}`);
    } else {
      const head = prHead(stdout);
      if (head.crossRepository) {
        log(`pull request #${number} comes from a fork, so its head branch is not a branch of this repository; ` + "this run stays on the detached checkout");
      } else if (!head.branch) {
        log(`pull request #${number} names no head branch`);
      } else if (!isBranchName(head.branch)) {
        log(`pull request #${number} names '${head.branch}', which is not a branch name`);
      } else if (!existsOnOrigin(head.branch)) {
        log(`'${head.branch}' does not exist on origin; this run stays on the detached checkout`);
      } else {
        branch = head.branch;
      }
    }
  }
  log(branch ? `the pull request's head branch is ${branch}` : "no head branch to check out; staying on the detached checkout");
  if (githubOutput)
    appendFileSync(githubOutput, `branch=${branch}
`);
}
if (import.meta.main)
  main();
export {
  existsOnOrigin,
  isBranchName,
  prHead,
  ref
};

#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/save_workspace.ts
import { existsSync as existsSync2, readdirSync as readdirSync2 } from "fs";
import { parseArgs } from "util";

// src/entrypoints/machinery/lib/atomaton-data.ts
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

// src/adapters/github/gh.ts
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
function gitRun(...args) {
  return run(["git", ...args]);
}

// src/entrypoints/machinery/lib/atomaton-data.ts
function gitIn(cwd, ...args) {
  const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? 1, stdout: proc.stdout ? proc.stdout.toString("utf8").trim() : "" };
}
function workspaceTargetPrefix(rootIssue) {
  return `workspace/issue-${rootIssue}`;
}
function saveWorkspace(prefix, sourceDir, commitMessage) {
  if (!existsSync(sourceDir))
    return true;
  if (gitRun("ls-remote", "--exit-code", "origin", "atomaton-data").code !== 0) {
    console.error("[atomaton-data] atomaton-data does not exist yet; skipping workspace save");
    return false;
  }
  gitRun("fetch", "origin", "atomaton-data");
  const worktreeDir = mkdtempSync(join(tmpdir(), "atomaton-data-ws-"));
  gitRun("worktree", "add", worktreeDir, "origin/atomaton-data");
  let saved = false;
  try {
    gitIn(worktreeDir, "config", "user.email", "action@github.com");
    gitIn(worktreeDir, "config", "user.name", "GitHub Actions");
    for (let attempt = 1;attempt <= 5; attempt++) {
      gitIn(worktreeDir, "fetch", "origin", "atomaton-data");
      gitIn(worktreeDir, "reset", "--hard", "origin/atomaton-data");
      const target = join(worktreeDir, prefix);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(sourceDir, target, { recursive: true });
      gitIn(worktreeDir, "add", "--all", prefix);
      if (gitIn(worktreeDir, "diff", "--cached", "--quiet").code === 0) {
        saved = true;
        break;
      }
      gitIn(worktreeDir, "commit", "-m", commitMessage);
      if (gitIn(worktreeDir, "push", "origin", "HEAD:atomaton-data").code === 0) {
        saved = true;
        break;
      }
      console.error(`[atomaton-data] workspace push attempt ${attempt} failed (concurrent push) -- retrying`);
      Bun.sleepSync(attempt * 2000);
    }
  } finally {
    gitRun("worktree", "remove", "--force", worktreeDir);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
  return saved;
}

// src/entrypoints/machinery/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath } from "url";

// src/domain/machinery/machinery-layout.ts
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

// src/entrypoints/machinery/lib/script-ref.ts
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath(importMetaUrl))}` };
}

// src/entrypoints/machinery/save_workspace.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "root-issue": { type: "string" },
      source: { type: "string" },
      agent: { type: "string" }
    }
  });
  const root = values["root-issue"];
  const source = values.source;
  if (!root || !source) {
    console.error("usage: save_workspace.ts --root-issue N --source PATH [--agent NAME]");
    process.exit(2);
  }
  if (!existsSync2(source)) {
    console.error(`[atomaton-workspace] ${source} does not exist; nothing to save`);
    return;
  }
  const count = readdirSync2(source).length;
  const prefix = workspaceTargetPrefix(root);
  const saved = saveWorkspace(prefix, source, `atomaton: workspace for issue #${root}${values.agent ? ` (${values.agent})` : ""} \u2014 ${count} entries`);
  console.error(saved ? `[atomaton-workspace] saved ${count} entries to ${prefix}` : `[atomaton-workspace] WARN could not save ${prefix}; the next run on this issue starts without these files`);
}
if (import.meta.main)
  main();
export {
  ref
};

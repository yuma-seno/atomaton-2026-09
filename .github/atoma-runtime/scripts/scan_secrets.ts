#!/usr/bin/env bun
// @bun

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
var USER_ROOT = ".github/atoma";
var RUNTIME_ROOT = ".github/atoma-runtime";
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

// src/scripts/scan_secrets.ts
var ref = defineScript(import.meta.url);
function log(message) {
  console.error(`[scan-secrets] ${message}`);
}
function branchRange() {
  gitRun("fetch", "--quiet", "--unshallow", "origin");
  const base = (process.env.GITHUB_BASE_REF || process.env.ATOMA_BASE_BRANCH || "main").trim();
  if (gitRun("fetch", "--quiet", "origin", base).code !== 0) {
    log(`could not fetch ${base}; scanning nothing rather than guessing at a range`);
    return;
  }
  const mergeBase = gitRun("merge-base", "FETCH_HEAD", "HEAD");
  if (mergeBase.code !== 0 || !mergeBase.stdout) {
    log(`no merge base with ${base}; scanning nothing rather than guessing at a range`);
    return;
  }
  return `${mergeBase.stdout.trim()}..HEAD`;
}
function run2(cmd) {
  return Bun.spawnSync({ cmd, stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
}
function main() {
  const range = branchRange();
  if (range === undefined)
    return;
  console.log(`Scanning ${range}`);
  const release = gh("api", "repos/gitleaks/gitleaks/releases/latest", "--jq", ".tag_name");
  if (release.code !== 0 || !release.stdout.trim()) {
    console.log("::warning::could not resolve the latest gitleaks release, so this branch was not scanned for credentials");
    return;
  }
  const tag = release.stdout.trim();
  const url = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/gitleaks_${tag.replace(/^v/, "")}_linux_x64.tar.gz`;
  if (run2(["bash", "-c", `curl -sSfL "${url}" | tar -xz -C /tmp gitleaks`]) !== 0) {
    console.log(`::warning::could not download gitleaks ${tag}, so this branch was not scanned for credentials`);
    return;
  }
  const found = run2(["/tmp/gitleaks", "git", `--log-opts=${range}`, "--redact", "--verbose", "--no-banner", "."]);
  if (found !== 0) {
    console.error("::error::gitleaks found a credential in this branch's commits. The output above says where.");
    process.exit(found);
  }
}
if (import.meta.main)
  main();
export {
  ref
};

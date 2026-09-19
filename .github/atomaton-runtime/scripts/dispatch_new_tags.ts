#!/usr/bin/env bun
// @bun

// src/scripts/dispatch_new_tags.ts
import { parseArgs } from "util";

// src/domain/shipped-workflows.ts
var DEFAULT_CD_WORKFLOW = "atomaton-deploy.yml";

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
function ghCommand() {
  const fake = (process.env.ATOMATON_FAKE_GH ?? "").trim();
  return fake ? [process.execPath, fake] : ["gh"];
}
function gh(...args) {
  return run([...ghCommand(), ...args]);
}

// src/lib/git-tags.ts
function readTagNames(repo) {
  const { code, stdout } = gh("api", "--paginate", `repos/${repo}/git/matching-refs/tags`, "--jq", ".[].ref");
  if (code)
    return null;
  return stdout.split(`
`).map((line) => line.trim()).filter((line) => line.startsWith("refs/tags/")).map((line) => line.slice("refs/tags/".length));
}
function tagsAdded(before, after) {
  const known = new Set(before);
  return after.filter((tag) => !known.has(tag));
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

// src/scripts/dispatch_new_tags.ts
var TAGS_BEFORE_VAR = "ATOMATON_TAGS_BEFORE";
var ref = defineScript(import.meta.url);
function parseBefore(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string"))
      return null;
    return parsed;
  } catch {
    return null;
  }
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" } }
  });
  const repo = (values.repo ?? "").trim();
  if (!repo) {
    console.error("::error::dispatch_new_tags: no --repo was given, so no tag could be deployed.");
    process.exit(1);
  }
  const before = parseBefore(process.env[TAGS_BEFORE_VAR] ?? "");
  if (before === null) {
    console.error(`::error::dispatch_new_tags: ${TAGS_BEFORE_VAR} was not a JSON array of tag names, so nothing could be compared.`);
    process.exit(1);
  }
  const after = readTagNames(repo);
  if (after === null) {
    console.error("::error::The repository's tags could not be read, so a tag this deployment created would not be deployed.");
    process.exit(1);
  }
  const added = tagsAdded(before, after);
  if (added.length === 0) {
    console.error("This deployment created no tags.");
    return;
  }
  let failed = 0;
  for (const tag of added) {
    const { code, stdout, stderr } = gh("workflow", "run", DEFAULT_CD_WORKFLOW, "--repo", repo, "--ref", tag, "-f", "trigger=tag");
    if (code) {
      failed += 1;
      console.error(`::error::Could not start a deployment for the new tag ${tag}: ${stderr || stdout}`);
      continue;
    }
    console.error(`Started a deployment for the new tag ${tag}.`);
  }
  if (failed > 0)
    process.exit(1);
}
if (import.meta.main)
  main();
export {
  TAGS_BEFORE_VAR,
  parseBefore,
  ref
};

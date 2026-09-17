#!/usr/bin/env bun
// @bun

// src/scripts/validate_deliverable.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join as join3 } from "path";
import { parseArgs } from "util";

// src/domain/control-commands.ts
var CONTROL_COMMAND_NAMES = ["stop", "resume"];
function isControlCommand(name) {
  return CONTROL_COMMAND_NAMES.includes(name);
}

// src/domain/declared-secrets.ts
var SECRET_SLOTS = 10;
var SECRET_SLOT_PREFIX = "ATOMATON_SECRET_";
var NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
var RUN_CREDENTIALS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ORCAROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ATOMA_COPILOT_TOKEN",
  "GH_TOKEN"
];
var TOOL_SECRETS = {
  field: "tools.secrets",
  reserved: new Set([
    ...RUN_CREDENTIALS,
    "AGENT",
    "ATOMATON_OPS_LOG",
    "ATOMA_PROVIDER",
    "ATOMATON_RELOAD_COUNT",
    "ATOMATON_RUN_TYPE",
    "GITHUB_RUN_ID",
    "ISSUE_NOTIFY",
    "ISSUE_NUMBER",
    "OPENAI_BASE_URL",
    "OPENROUTER_BASE_URL",
    "ORCAROUTER_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "COPILOT_BASE_URL",
    "ATOMA_PROVIDER_IN",
    "OPENAI_BASE_URL_IN"
  ])
};
var CHECK_SECRETS = {
  field: "checks.atomaton_runs.secrets",
  reserved: new Set(["GH_TOKEN"])
};
var DEPLOY_SECRETS = {
  field: "deploy.atomaton_runs.secrets",
  reserved: new Set([
    "ATOMATON_DEPLOY_REF",
    "ATOMATON_DEPLOY_TARGET",
    "ATOMATON_DEPLOY_TARGET_INPUT",
    "ATOMATON_DEPLOY_TRIGGER",
    "GH_TOKEN"
  ])
};
var SECRET_DESTINATIONS = {
  tools: TOOL_SECRETS,
  checks: CHECK_SECRETS,
  deploy: DEPLOY_SECRETS
};
function resolveDeclaredSecrets(raw, destination) {
  const { field, reserved } = destination;
  if (raw === undefined || raw === null)
    return { names: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { names: [], problems: [`\`${field}\` must be an array of secret names.`] };
  }
  const problems = [];
  const names = [];
  const seen = new Set;
  for (const entry of raw) {
    if (typeof entry !== "string") {
      problems.push(`\`${field}\` entries must be strings; found ${JSON.stringify(entry)}.`);
      continue;
    }
    const name = entry.trim();
    if (!NAME_PATTERN.test(name)) {
      problems.push(`\`${field}\`: '${name}' is not a usable secret name. Expected uppercase letters, digits and underscores, starting with a letter \u2014 e.g. 'SLACK_TOKEN'.`);
      continue;
    }
    if (reserved.has(name)) {
      problems.push(`\`${field}\`: '${name}' is already part of the environment this workflow provides, so declaring it would replace that value rather than add a credential. Give the secret another name.`);
      continue;
    }
    if (name.startsWith(SECRET_SLOT_PREFIX)) {
      problems.push(`\`${field}\`: '${name}' collides with the slots this mechanism uses internally. Give the secret another name.`);
      continue;
    }
    if (seen.has(name)) {
      problems.push(`\`${field}\`: '${name}' is declared more than once.`);
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  if (names.length > SECRET_SLOTS) {
    problems.push(`\`${field}\` declares ${names.length} secrets but a run carries at most ${SECRET_SLOTS}. Raising the cap needs a new release, since each slot is a line of generated workflow YAML.`);
  }
  return problems.length > 0 ? { names: [], problems } : { names, problems };
}

// src/domain/deploy-targets.ts
var TRIGGERS = ["merge", "tag", "manual"];
var NAME_PATTERN2 = /^[a-z][a-z0-9-]*$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readCommands(raw, where, problems) {
  const before = problems.length;
  if (!Array.isArray(raw)) {
    problems.push(`${where}: \`commands\` must be an array of shell commands.`);
    return [];
  }
  const commands = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`${where}: every command must be a non-empty string; found ${JSON.stringify(entry)}.`);
      continue;
    }
    commands.push(entry);
  }
  if (commands.length === 0 && problems.length === before) {
    problems.push(`${where}: declares no commands, so it would deploy nothing.`);
  }
  return commands;
}
function resolveDeployTargets(raw) {
  if (raw === undefined || raw === null)
    return { targets: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { targets: [], problems: ["`deploy.atomaton_runs.targets` must be an array."] };
  }
  const problems = [];
  const targets = [];
  const seen = new Set;
  raw.forEach((entry, index) => {
    const where = `\`deploy.atomaton_runs.targets[${index}]\``;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      return;
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!NAME_PATTERN2.test(name)) {
      problems.push(`${where}: \`name\` must be lowercase letters, digits and hyphens \u2014 e.g. 'production'.`);
      return;
    }
    if (seen.has(name)) {
      problems.push(`${where}: '${name}' is declared more than once.`);
      return;
    }
    const on = entry.on;
    if (typeof on !== "string" || !TRIGGERS.includes(on)) {
      problems.push(`${where}: \`on\` must be one of ${TRIGGERS.map((t) => `'${t}'`).join(", ")}.`);
      return;
    }
    const trigger = on;
    const tagsRaw = entry.tags ?? [];
    if (!Array.isArray(tagsRaw) || tagsRaw.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
      problems.push(`${where}: \`tags\` must be an array of non-empty patterns.`);
      return;
    }
    const tags = tagsRaw.map((tag) => tag.trim());
    const badPattern = tags.map((tag) => tagPatternProblem(tag)).find((problem) => problem !== "");
    if (badPattern) {
      problems.push(`${where}: ${badPattern}`);
      return;
    }
    if (trigger === "tag" && tags.length === 0) {
      problems.push(`${where}: \`on: tag\` needs at least one pattern in \`tags\` \u2014 e.g. ["v*"].`);
      return;
    }
    if (trigger !== "tag" && tags.length > 0) {
      problems.push(`${where}: \`tags\` only applies to \`on: tag\`; this target is \`on: ${trigger}\`.`);
      return;
    }
    const before = problems.length;
    const commands = readCommands(entry.commands, where, problems);
    if (problems.length > before)
      return;
    seen.add(name);
    targets.push({ name, on: trigger, tags, commands });
  });
  return problems.length > 0 ? { targets: [], problems } : { targets, problems };
}
function tagPatternProblem(pattern) {
  const body = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
  if (body.includes("*")) {
    return `"${pattern}" uses a '*' somewhere other than the end, which this matcher cannot honour, ` + 'so it would match no tag. Write a literal tag, or a prefix followed by "*" \u2014 e.g. "v*".';
  }
  if (/[?[\]{}]/.test(body)) {
    return `"${pattern}" uses a glob character this matcher cannot honour, so it would match no tag. ` + 'Write a literal tag, or a prefix followed by "*".';
  }
  return "";
}

// src/domain/path-patterns.ts
var GLOB_CHARACTERS = /[*?[\]{}]/;
function pathPatternProblem(pattern) {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    return "a path pattern must be a non-empty string";
  }
  if (pattern !== pattern.trim()) {
    return `"${pattern}" has surrounding whitespace`;
  }
  if (pattern.endsWith("/")) {
    return `"${pattern}" ends in a slash, so it would match nothing. ` + `Write "${pattern}**" for everything under it, or drop the slash to match that one path.`;
  }
  const body = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  if (body === "") {
    return `"${pattern}" names no directory. Write the directory before the "/**".`;
  }
  const glob = GLOB_CHARACTERS.exec(body);
  if (glob) {
    return `"${pattern}" uses the glob character '${glob[0]}', which this matcher cannot honour, ` + 'so it would match nothing. Write a literal path, or a directory followed by "/**".';
  }
  return "";
}

// src/domain/merge-gates.ts
var CONDITION_KEYS = [
  "files_added",
  "files_removed",
  "files_modified",
  "files_changed",
  "labels",
  "title_matches"
];
var GATE_KEYS = ["reason", "when"];
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readPatterns(raw, where, problems) {
  if (raw === undefined)
    return [];
  if (!Array.isArray(raw)) {
    problems.push(`${where} must be an array of path patterns.`);
    return [];
  }
  if (raw.length === 0) {
    problems.push(`${where} is empty, so it constrains nothing; remove the key instead.`);
    return [];
  }
  const patterns = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      problems.push(`${where}: every pattern must be a string; found ${JSON.stringify(entry)}.`);
      continue;
    }
    const problem = pathPatternProblem(entry);
    if (problem) {
      problems.push(`${where}: ${problem}`);
      continue;
    }
    patterns.push(entry.trim());
  }
  return patterns;
}
function readLabels(raw, where, problems) {
  if (raw === undefined)
    return [];
  if (!Array.isArray(raw) || raw.some((label) => typeof label !== "string" || label.trim() === "")) {
    problems.push(`${where} must be an array of non-empty label names.`);
    return [];
  }
  if (raw.length === 0) {
    problems.push(`${where} is empty, so it constrains nothing; remove the key instead.`);
    return [];
  }
  return raw.map((label) => label.trim());
}
function readTitleMatches(raw, where, problems) {
  if (raw === undefined)
    return "";
  if (typeof raw !== "string" || raw.trim() === "") {
    problems.push(`${where} must be a non-empty regular expression.`);
    return "";
  }
  try {
    new RegExp(raw, "i");
  } catch (error) {
    problems.push(`${where} is not a valid regular expression: ${error.message}`);
    return "";
  }
  return raw;
}
function constrainsAnything(when) {
  return when.filesAdded.length > 0 || when.filesRemoved.length > 0 || when.filesModified.length > 0 || when.filesChanged.length > 0 || when.labels.length > 0 || when.titleMatches !== "";
}
function resolveMergeGates(raw) {
  if (raw === undefined || raw === null)
    return { gates: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { gates: [], problems: ["`merge.gates` must be an array of gate objects."] };
  }
  const problems = [];
  const gates = [];
  raw.forEach((entry, index) => {
    const where = `\`merge.gates[${index}]\``;
    if (!isRecord2(entry)) {
      problems.push(`${where} must be an object with \`reason\` and \`when\`.`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!GATE_KEYS.includes(key)) {
        problems.push(`${where}: unknown key \`${key}\`; a gate has \`reason\` and \`when\`.`);
      }
    }
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    if (reason === "") {
      problems.push(`${where}: \`reason\` must say why a person should merge this, in their words.`);
    }
    if (!isRecord2(entry.when)) {
      problems.push(`${where}: \`when\` must be an object naming at least one condition ` + `(${CONDITION_KEYS.join(", ")}).`);
      return;
    }
    const declared = entry.when;
    for (const key of Object.keys(declared)) {
      if (!CONDITION_KEYS.includes(key)) {
        problems.push(`${where}: unknown condition \`${key}\`. A misspelled condition matches nothing, which ` + `looks exactly like a gate nobody needed -- so it is an error rather than a no-op. ` + `Known conditions: ${CONDITION_KEYS.join(", ")}.`);
      }
    }
    const when = {
      filesAdded: readPatterns(declared.files_added, `${where}.when.files_added`, problems),
      filesRemoved: readPatterns(declared.files_removed, `${where}.when.files_removed`, problems),
      filesModified: readPatterns(declared.files_modified, `${where}.when.files_modified`, problems),
      filesChanged: readPatterns(declared.files_changed, `${where}.when.files_changed`, problems),
      labels: readLabels(declared.labels, `${where}.when.labels`, problems),
      titleMatches: readTitleMatches(declared.title_matches, `${where}.when.title_matches`, problems)
    };
    if (!constrainsAnything(when)) {
      problems.push(`${where}: \`when\` names no usable condition, so this gate would stop every merge. ` + `Set \`merge.policy\` to "manual" if that is the intent.`);
      return;
    }
    gates.push({ reason, when });
  });
  return problems.length > 0 ? { gates: [], problems } : { gates, problems };
}

// src/domain/shipped-workflows.ts
var DEFAULT_CI_WORKFLOW = "atomaton-check.yml";
var DEFAULT_CD_WORKFLOW = "atomaton-deploy.yml";

// src/domain/deliverable-integrity.ts
var CONFIG_SCHEMA = {
  children: {
    base_branch: null,
    environment: { children: { setup_commands: null, max_reloads: null } },
    checks: {
      children: {
        atomaton_runs: { children: { commands: null, secrets: null, runs_on: null } },
        your_workflow: null
      }
    },
    deploy: {
      children: {
        atomaton_runs: { children: { targets: null, secrets: null, runs_on: null } },
        your_workflow: null
      }
    },
    merge: { children: { policy: null, governed_paths: null, gates: null } },
    chain: {
      children: {
        after_handoffs: null,
        after_runs_without_change: null,
        labels: { children: { in_progress: null, sub_issue: null, launched: null }, anyName: null }
      }
    },
    tools: {
      children: {
        secrets: null,
        watch: { anyName: null },
        servers: { anyName: { anyName: null } },
        packages: { children: { npm: null, bun: null, pip: null } }
      }
    }
  }
};
function arm(section) {
  if (!isRecord3(section))
    return {};
  return isRecord3(section.atomaton_runs) ? section.atomaton_runs : {};
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function unknownKeys(value, section, prefix) {
  if (!isRecord3(value))
    return [];
  const unknown = [];
  for (const [name, child] of Object.entries(value)) {
    const path = `${prefix}${name}`;
    const declared = section.children?.[name];
    if (declared !== undefined) {
      if (declared)
        unknown.push(...unknownKeys(child, declared, `${path}.`));
      continue;
    }
    if (section.anyName !== undefined) {
      if (section.anyName)
        unknown.push(...unknownKeys(child, section.anyName, `${path}.`));
      continue;
    }
    unknown.push(path);
  }
  return unknown;
}
function configProblems(facts) {
  const problems = [];
  const { config, agentNames, workflowFiles } = facts;
  if (!isRecord3(config)) {
    return ["`config.yaml` must be a YAML mapping."];
  }
  for (const key of unknownKeys(config, CONFIG_SCHEMA, "").sort()) {
    problems.push(`\`${key}\` in config.yaml is not a setting Atomaton reads. Check the spelling.`);
  }
  for (const section of ["checks", "deploy"]) {
    const value = config[section];
    if (!isRecord3(value))
      continue;
    if (value.atomaton_runs !== undefined && value.your_workflow !== undefined) {
      problems.push("`" + section + "` sets both `atomaton_runs` and `your_workflow`. They are alternatives: " + "`your_workflow` dispatches a workflow of your own and nothing reads " + "`atomaton_runs`. Remove whichever you did not mean.");
    }
  }
  const merge = isRecord3(config.merge) ? config.merge : {};
  problems.push(...resolveMergeGates(merge.gates).problems);
  const deployRuns = arm(config.deploy);
  problems.push(...resolveDeployTargets(deployRuns.targets).problems);
  const checkRuns = arm(config.checks);
  const tools = isRecord3(config.tools) ? config.tools : {};
  problems.push(...resolveDeclaredSecrets(tools.secrets, SECRET_DESTINATIONS.tools).problems);
  problems.push(...resolveDeclaredSecrets(checkRuns.secrets, SECRET_DESTINATIONS.checks).problems);
  problems.push(...resolveDeclaredSecrets(deployRuns.secrets, SECRET_DESTINATIONS.deploy).problems);
  for (const name of agentNames.filter(isControlCommand).sort()) {
    problems.push(`agent-definitions/${name}.md is named after the '/${name}' control command, ` + `so '/${name}' will never dispatch it. Rename the agent.`);
  }
  if (agentNames.length === 0) {
    problems.push("No agent definitions were found. `.github/atomaton/agent-definitions/*.md` is empty or missing.");
  }
  if (workflowFiles.length > 0) {
    const present = new Set(workflowFiles);
    for (const [section, fallback] of [
      ["checks", DEFAULT_CI_WORKFLOW],
      ["deploy", DEFAULT_CD_WORKFLOW]
    ]) {
      const named = isRecord3(config[section]) ? config[section].your_workflow : undefined;
      const configured = typeof named === "string" ? named.trim() : "";
      const effective = configured || fallback;
      if (!present.has(effective)) {
        problems.push(`\`${section}.your_workflow\` resolves to '${effective}', which is not a file in .github/workflows/. ` + (configured ? "Check the name." : "The shipped default is missing from this repository."));
      }
    }
  }
  const chain = isRecord3(config.chain) ? config.chain : {};
  if (isRecord3(chain.labels)) {
    for (const [key, value] of Object.entries(chain.labels)) {
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(`\`chain.labels.${key}\` must be a non-empty label name.`);
      }
    }
  }
  return problems;
}

// src/domain/generated-file-hint.ts
var EDITABLE_SOURCE = "`tools.servers` in .github/atomaton/config.yaml";
function withEditableSource(problem) {
  if (problem.includes("tools.yaml")) {
    return `${problem} \u2014 that file is generated from ${EDITABLE_SOURCE} and is rewritten on ` + "every build, so an edit to it is lost. Change the config.";
  }
  if (problem.startsWith("Hook script not found")) {
    return `${problem} \u2014 hook paths are resolved against .github/atomaton/tools/, and are ` + `declared in ${EDITABLE_SOURCE} (per server) or \`tools.watch\` (file-wide).`;
  }
  return problem;
}

// src/domain/tools-file.ts
import { isAbsolute, join as join2, resolve } from "path";

// src/domain/shipped-servers.ts
import { readFileSync } from "fs";
import { dirname, join } from "path";
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

// src/domain/shipped-servers.ts
function defaultPath() {
  const belowRoot = TOOL_DEFAULTS_FILE.slice(TOOL_DEFAULTS_FILE.indexOf("/") + 1);
  return join(dirname(fileURLToPath(import.meta.url)), "..", ...belowRoot.split("/"));
}
var cached;
function toolDefaults(path = defaultPath()) {
  if (cached)
    return cached;
  const parsed = Bun.YAML.parse(readFileSync(path, "utf8"));
  cached = { watch: parsed.watch ?? {}, servers: parsed.servers ?? {} };
  return cached;
}

// src/domain/tools-file.ts
function toolsFileFrom(tools, hookBase, defaultsPath) {
  const out = {};
  const defaults = toolDefaults(defaultsPath);
  const watch = mergedWatch(tools?.watch, defaults);
  if (Object.keys(watch).length > 0)
    out.hooks = absoluteHooks(watch, hookBase);
  for (const [name, server] of Object.entries(mergedServers(tools?.servers, defaults))) {
    const { settings: _delivery, ...forTheCore } = server;
    if (isRecord4(forTheCore.hooks))
      forTheCore.hooks = absoluteHooks(forTheCore.hooks, hookBase);
    out[name] = forTheCore;
  }
  return out;
}
function mergedServers(configured, defaults) {
  const out = {};
  for (const [name, server] of Object.entries(defaults.servers)) {
    const { description: _ours, ...rest } = server;
    out[name] = { ...rest };
  }
  for (const [name, server] of Object.entries(configured ?? {})) {
    out[name] = { ...out[name] ?? {}, ...server };
  }
  return out;
}
function mergedWatch(configured, defaults) {
  const out = {};
  for (const [key, scripts] of Object.entries(defaults.watch))
    out[key] = [...scripts];
  for (const [key, added] of Object.entries(configured ?? {})) {
    const theirs = Array.isArray(added) ? added : [added];
    out[key] = [...out[key] ?? [], ...theirs];
  }
  return out;
}
var HOOK_SCRIPT_KEYS = ["before_tool", "after_tool"];
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function absoluteHooks(hooks, base) {
  const out = { ...hooks };
  for (const key of HOOK_SCRIPT_KEYS) {
    const declared = out[key];
    if (Array.isArray(declared)) {
      out[key] = declared.map((script) => absolutePath(script, base));
    } else if (typeof declared === "string") {
      out[key] = absolutePath(declared, base);
    }
  }
  return out;
}
function absolutePath(script, base) {
  if (typeof script !== "string" || script.length === 0)
    return script;
  if (isAbsolute(script))
    return script;
  const from = isAbsolute(base) ? base : resolve(base);
  return join2(from, script).split("\\").join("/");
}
function reservedServerNames(tools) {
  return Object.keys(tools?.servers ?? {}).filter((name) => name === "hooks");
}

// src/scripts/lib/script-ref.ts
import { basename } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
function defineScript(importMetaUrl) {
  return { runtimePath: `${SCRIPTS_DIR}/${basename(fileURLToPath2(importMetaUrl))}` };
}

// src/scripts/validate_deliverable.ts
var ref = defineScript(import.meta.url);

class CannotCheck extends Error {
}
function validatorProblems(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("\u2717")).map((line) => line.replace(/^\u2717\s*/, ""));
}
function validateAgentDefinition(atoma, agentDef, toolsFile, label) {
  const proc = Bun.spawnSync({
    cmd: [atoma, "validate", "--agent-def", agentDef, "--tools-file", toolsFile],
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdout = proc.stdout ? proc.stdout.toString("utf8") : "";
  const stderr = proc.stderr ? proc.stderr.toString("utf8") : "";
  if (proc.exitCode === null) {
    throw new CannotCheck(`could not run \`${atoma} validate\`: ${stderr.trim() || "no output"}`);
  }
  if (proc.exitCode === 0)
    return [];
  const found = validatorProblems(`${stdout}
${stderr}`);
  if (found.length > 0)
    return found.map((problem) => `${label}: ${withEditableSource(problem)}`);
  return [`${label}: \`atoma validate\` failed without saying why: ${stderr.trim() || stdout.trim() || "no output"}`];
}
function writeToolsFileFor(root) {
  const atomaDir = join3(root, ".github", "atomaton");
  const runtimeTools = join3(root, ".github", "atomaton-runtime", "tools");
  const config = Bun.YAML.parse(readFileSync2(join3(atomaDir, "config.yaml"), "utf8"));
  const collisions = reservedServerNames(config.tools);
  if (collisions.length > 0) {
    throw new Error(`\`tools.servers\` may not be named ${collisions.join(", ")} \u2014 reserved by the core`);
  }
  const out = join3(mkdtempSync(join3(tmpdir(), "atomaton-validate-")), "tools.yaml");
  writeFileSync(out, Bun.YAML.stringify(toolsFileFrom(config.tools, runtimeTools, join3(runtimeTools, "defaults.yaml")), null, 2));
  return out;
}
function agentNames(agentDir) {
  if (!existsSync(agentDir))
    return [];
  return readdirSync(agentDir).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -".md".length)).sort();
}
function workflowFiles(workflowDir) {
  if (!existsSync(workflowDir))
    return [];
  return readdirSync(workflowDir).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
}
function collect(root, atoma) {
  if (!existsSync(root))
    throw new CannotCheck(`--root ${root} does not exist`);
  const atomaDir = join3(root, ".github", "atomaton");
  const agentDir = join3(atomaDir, "agent-definitions");
  const configFile = join3(atomaDir, "config.yaml");
  const names = agentNames(agentDir);
  const problems = [];
  if (!existsSync(configFile)) {
    problems.push(`${configFile} is missing. Every workflow reads it.`);
  } else {
    let config;
    try {
      config = Bun.YAML.parse(readFileSync2(configFile, "utf8"));
    } catch (error) {
      problems.push(`${configFile} is not valid YAML: ${error.message}`);
    }
    if (config !== undefined) {
      problems.push(...configProblems({
        config,
        agentNames: names,
        workflowFiles: workflowFiles(join3(root, ".github", "workflows"))
      }));
    }
  }
  if (names.length > 0) {
    let toolsFile;
    try {
      toolsFile = writeToolsFileFor(root);
    } catch (error) {
      problems.push(`could not write the tools file from config.yaml: ${error.message}`);
      return problems;
    }
    for (const name of names) {
      problems.push(...validateAgentDefinition(atoma, join3(agentDir, `${name}.md`), toolsFile, `${name}.md`));
    }
  }
  return problems;
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      root: { type: "string" },
      atoma: { type: "string" },
      report: { type: "string" }
    }
  });
  const root = values.root?.trim() || ".";
  const atoma = values.atoma?.trim() || "atoma";
  let problems;
  try {
    problems = collect(root, atoma);
  } catch (error) {
    if (!(error instanceof CannotCheck))
      throw error;
    console.error(`[atomaton-validate-deliverable] cannot check: ${error.message}`);
    process.exit(2);
  }
  if (values.report)
    writeFileSync(values.report, problems.map((problem) => `${problem}
`).join(""));
  if (problems.length === 0) {
    console.log(`The deliverable in ${root} is internally consistent.`);
    return;
  }
  console.error(`${problems.length} problem(s) in ${root}:`);
  for (const problem of problems)
    console.error(`  - ${problem}`);
  process.exit(1);
}
if (import.meta.main)
  main();
export {
  ref,
  validatorProblems
};

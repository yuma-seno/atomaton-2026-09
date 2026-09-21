#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/dispatch_agent.ts
import { parseArgs } from "util";

// src/domain/work/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);
function isAgentName(value) {
  return AGENT_NAME_RE.test(value);
}

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
function ghCommand() {
  const fake = (process.env.ATOMATON_FAKE_GH ?? "").trim();
  return fake ? [process.execPath, fake] : ["gh"];
}
function gh(...args) {
  return run([...ghCommand(), ...args]);
}
function ghRead(...args) {
  let result = gh(...args);
  for (const delay of [2000, 6000]) {
    if (result.code === 0 || !looksTransient(result))
      return result;
    console.error(`::warning::gh ${args.slice(0, 2).join(" ")} failed transiently, retrying: ${result.stderr || result.stdout}`);
    Bun.sleepSync(delay);
    result = gh(...args);
  }
  return result;
}
function looksTransient(result) {
  const text = `${result.stderr} ${result.stdout}`;
  if (/HTTP (429|5[0-9][0-9])(?![0-9])/.test(text))
    return true;
  return /(timeout|timed out|connection reset|unexpected EOF|TLS handshake|temporary failure)/i.test(text);
}
function dispatchWorkflow(context, workflow, args = [], log = (m) => console.error(m)) {
  const { code, stdout, stderr } = gh("workflow", "run", workflow, ...args);
  if (code) {
    log(`${context}: WARN failed to dispatch ${workflow}: ${stderr || stdout}`);
    return false;
  }
  log(`${context}: dispatched ${workflow}`);
  return true;
}

// src/adapters/runner/ops-log.ts
import { appendFileSync } from "fs";
var OPS_LOG_PATH = process.env.ATOMATON_OPS_LOG ?? "/tmp/atomaton_ops.log";
function logOp(op, payload = {}) {
  const entry = { ts: new Date().toISOString(), op, ...payload };
  try {
    appendFileSync(OPS_LOG_PATH, JSON.stringify(entry) + `
`);
  } catch (e) {
    console.error(`[ops-log] WARN: failed to write op log: ${e}`);
  }
}
function logDispatch(target, agent, extra = {}) {
  logOp("dispatch", { target, agent, ...extra });
}

// src/adapters/github/outcome.ts
function issueOutcome(reason) {
  const said = (reason ?? "").toLowerCase();
  return said === "not_planned" || said === "duplicate" ? "abandoned" : "done";
}
function pullRequestOutcome(merged) {
  return merged ? "done" : "abandoned";
}

// src/adapters/github/target-state.ts
function readTargetState(number, repo) {
  const path = repo ? `repos/${repo}/issues/${number}` : `repos/{owner}/{repo}/issues/${number}`;
  const { code, stdout, stderr } = ghRead("api", path);
  if (code !== 0) {
    return { known: false, why: (stderr || stdout || `gh exited ${code}`).trim().split(`
`)[0] ?? "" };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { known: false, why: "the response was not JSON" };
  }
  const isPr = parsed.pull_request !== undefined;
  const kind = isPr ? "pull-request" : "issue";
  if (parsed.state === "open")
    return { known: true, kind, state: "open" };
  if (parsed.state === "closed") {
    return {
      known: true,
      kind,
      state: isPr ? pullRequestOutcome(Boolean(parsed.pull_request?.merged_at)) : issueOutcome(parsed.state_reason)
    };
  }
  return { known: false, why: `unrecognised state ${JSON.stringify(parsed.state ?? null)}` };
}

// src/domain/work/closed-issue.ts
function mayStartWorkOn(target) {
  return target.known && target.state === "open";
}
function canBeReopened(target) {
  return target.known && !(target.kind === "pull-request" && target.state === "done");
}
function recoveryAdvice(state, number, command) {
  if (state.known && !canBeReopened(state)) {
    return `#${number} is merged, and GitHub cannot reopen a merged pull request. ` + `Open an issue for the follow-up instead.`;
  }
  return `Reopen #${number} and comment \`${command}\` to run it.`;
}
function mentionPrefix(logins) {
  return logins.length > 0 ? `${logins.map((l) => `@${l}`).join(" ")} ` : "";
}
function dispatchRefusedNotice(refused) {
  const { agent, number, context, state, notify } = refused;
  const why = !state.known ? `the state of #${number} could not be read (${state.why})` : `#${number} is closed`;
  return [
    `${mentionPrefix(notify ? [notify] : [])}Atomaton: \`${agent}\` was not started on #${number}, because ${why}.`,
    "",
    `What was about to happen: ${context}.`,
    "",
    "Nothing will retry this.",
    "",
    !state.known ? `Start it by hand once #${number} can be read: comment \`/${agent}\` on it.` : recoveryAdvice(state, number, `/${agent}`)
  ].join(`
`);
}

// src/adapters/actions/dispatch.ts
function runnerWorkflow() {
  return process.env.ATOMATON_DISPATCH_WORKFLOW || "atomaton-runner.yml";
}
function refuseClosedTarget(d, state) {
  const log = d.log ?? ((message) => console.error(message));
  const body = dispatchRefusedNotice({
    agent: d.agent,
    number: Number(d.number),
    context: d.context,
    state,
    notify: d.notify ?? ""
  });
  const { code, stdout, stderr } = gh("issue", "comment", String(d.number), ...d.repo ? ["--repo", d.repo] : [], "--body", body);
  if (code !== 0) {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open), and could not post the notice: ${stderr || stdout}`);
  } else {
    log(`${d.context}: refused to dispatch onto #${d.number} (not open); notice posted`);
  }
  return "refused-closed";
}
function dispatchRunner(d) {
  const state = readTargetState(d.number, d.repo);
  if (!mayStartWorkOn(state))
    return refuseClosedTarget(d, state);
  const args = [
    ...d.repo ? ["--repo", d.repo] : [],
    "--field",
    `agent=${d.agent}`,
    "--field",
    `number=${d.number}`,
    "--field",
    `type=${d.type}`,
    "--field",
    `notify=${d.notify ?? ""}`,
    "--field",
    `reload_count=${d.reloadCount ?? 0}`
  ];
  if (!dispatchWorkflow(d.context, runnerWorkflow(), args, d.log))
    return "failed";
  logDispatch(d.type, d.agent, { number: Number(d.number) });
  return "dispatched";
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

// src/entrypoints/machinery/dispatch_agent.ts
var ref = defineScript(import.meta.url);
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      agent: { type: "string" },
      number: { type: "string" },
      type: { type: "string" },
      notify: { type: "string" },
      repo: { type: "string" },
      context: { type: "string" }
    }
  });
  const agent = (values.agent ?? "").trim();
  const number = Number((values.number ?? "").trim());
  const type = (values.type ?? "").trim();
  const context = (values.context ?? "").trim();
  if (!isAgentName(agent)) {
    console.error(`::error::dispatch_agent: '${agent}' is not an agent name, so nothing was dispatched.`);
    process.exit(1);
  }
  if (type !== "issue" && type !== "pr") {
    console.error(`::error::dispatch_agent: --type must be 'issue' or 'pr', not '${type}'.`);
    process.exit(1);
  }
  if (!Number.isInteger(number) || number <= 0) {
    console.error(`::error::dispatch_agent: --number must be a positive number, not '${values.number ?? ""}'.`);
    process.exit(1);
  }
  if (!context) {
    console.error("::error::dispatch_agent: --context is required; it is what a person reads if this is refused.");
    process.exit(1);
  }
  const outcome = dispatchRunner({
    context,
    agent,
    type,
    number,
    notify: values.notify ?? "",
    repo: (values.repo ?? "").trim() || undefined
  });
  if (outcome === "failed") {
    console.error(`::error::Could not dispatch ${agent} on ${type} #${number}.`);
    process.exit(1);
  }
}
if (import.meta.main)
  main();
export {
  ref
};

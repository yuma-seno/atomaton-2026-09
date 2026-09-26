#!/usr/bin/env bun
// @bun

// src/entrypoints/machinery/validate_pull_request.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { parseArgs } from "util";

// src/domain/work/pr-validation.ts
var PASSING = new Set(["success", "skipped", "neutral"]);
var CI_RETRY_LIMIT = 3;
function contextsPassed(verdict) {
  return verdict === "passed";
}
function handTo(agent) {
  const named = agent.trim();
  return named === "" ? {} : { next: { agent: named } };
}
function decideValidationOutcome(input) {
  const { conclusion, reviewerAgent, engineerAgent, askedByPerson = false, priorRetries = 0 } = input;
  const deliverableProblems = input.deliverableProblems ?? [];
  if (deliverableProblems.length > 0) {
    const count = `${deliverableProblems.length} problem${deliverableProblems.length === 1 ? "" : "s"}`;
    if (priorRetries >= CI_RETRY_LIMIT) {
      return {
        verdict: "retries-exhausted",
        summary: `The deliverable is still not internally consistent (${count}) after ${priorRetries} attempts. ` + `Stopping rather than dispatching the engineer again; a human should look.`
      };
    }
    return {
      verdict: "deliverable-invalid",
      ...handTo(engineerAgent),
      summary: `.github/atomaton/ is not internally consistent (${count}), so CI was not run.`
    };
  }
  const normalised = conclusion.trim().toLowerCase();
  const passed = PASSING.has(normalised);
  if (passed) {
    return { verdict: "passed", ...handTo(reviewerAgent), summary: `CI concluded ${normalised}.` };
  }
  if (!normalised) {
    return {
      verdict: "no-conclusion",
      summary: "CI never reported a conclusion. Nothing was dispatched; a human should look."
    };
  }
  if (priorRetries >= CI_RETRY_LIMIT) {
    return {
      verdict: "retries-exhausted",
      summary: `CI concluded ${normalised} after ${priorRetries} attempts at fixing it. ` + `Stopping rather than dispatching the engineer again; a human should look.`
    };
  }
  if (askedByPerson) {
    return {
      verdict: "failed",
      summary: `CI concluded ${normalised}. This run was asked for by a person, so nobody was dispatched.`
    };
  }
  return {
    verdict: "failed",
    ...handTo(engineerAgent),
    summary: `CI concluded ${normalised}. Returning to the engineer with the failing job.`
  };
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
function dispatchWorkflow(context, workflow, args = [], log = (m) => console.error(m)) {
  const { code, stdout, stderr } = gh("workflow", "run", workflow, ...args);
  if (code) {
    log(`${context}: WARN failed to dispatch ${workflow}: ${stderr || stdout}`);
    return false;
  }
  log(`${context}: dispatched ${workflow}`);
  return true;
}

// src/adapters/github/branch-rules.ts
var FEATURE_UNAVAILABLE = /upgrade to github|make this repository public/i;
function readBranchRules(repo, baseRef) {
  if (!baseRef)
    return { known: false, why: "no base branch was given" };
  const { code, stdout, stderr } = gh("api", `repos/${repo}/rules/branches/${baseRef}`);
  if (code) {
    if (FEATURE_UNAVAILABLE.test(`${stderr} ${stdout}`)) {
      return {
        known: true,
        enforceable: false,
        contexts: [],
        pullRequestRequired: false,
        why: "branch rules are not available on this repository (they are a paid feature on a " + "private one), so GitHub cannot require a status check or refuse a merge here"
      };
    }
    return { known: false, why: `the branch rules for ${baseRef} could not be read` };
  }
  try {
    const rules = JSON.parse(stdout || "[]");
    return {
      known: true,
      enforceable: true,
      contexts: rules.filter((rule) => rule.type === "required_status_checks").flatMap((rule) => rule.parameters?.required_status_checks ?? []).map((check) => check.context),
      pullRequestRequired: rules.some((rule) => rule.type === "pull_request")
    };
  } catch {
    return { known: false, why: `the branch rules for ${baseRef} were not valid JSON` };
  }
}

// src/domain/work/agent-name.ts
var AGENT_NAME_PATTERN = "[a-z][a-z0-9-]*";
var AGENT_NAME_RE = new RegExp(`^${AGENT_NAME_PATTERN}$`);

// src/adapters/github/tags.ts
var TAG_PREFIX = `atomaton:`;
var EVERY_TAG_PATTERN = [];
function makeTag(key, valuePattern, parse, render) {
  const pattern = `<!--\\s*${TAG_PREFIX}${key}=(?:${valuePattern})\\s*-->`;
  EVERY_TAG_PATTERN.push(pattern);
  const re = new RegExp(`<!--\\s*${TAG_PREFIX}${key}=(${valuePattern})\\s*-->`);
  return {
    write: (value) => `<!-- ${TAG_PREFIX}${key}=${render(value)} -->`,
    read: (text) => {
      const m = re.exec(text);
      return m ? parse(m[1]) : undefined;
    },
    has: (text) => re.test(text),
    search: (value) => `${TAG_PREFIX}${key}=${render(value)}`
  };
}
function numericTag(key) {
  return makeTag(key, "\\d+", Number, String);
}
function stringTag(key, valuePattern) {
  return makeTag(key, valuePattern, (raw) => raw, (value) => value);
}
var STOP_TAG = stringTag("stop", "requested");
var ENDED_TAG = stringTag("ended", "stopped|limit|done");
var PARENT_ISSUE_TAG = numericTag("parent-issue");
var NOTIFY_TAG = stringTag("notify", "[A-Za-z0-9-]+");
var ORIGIN_AGENT_TAG = stringTag("origin-agent", AGENT_NAME_PATTERN);
var DISPATCH_TAG = stringTag("dispatch", AGENT_NAME_PATTERN);
var AGENT_TAG = stringTag("agent", AGENT_NAME_PATTERN);
var CHANGED_TAG = stringTag("changed", "yes|no");
var LLM_CONTEXT_TAG = stringTag("llm-context", "include|exclude");
var AGGREGATED_TAG = numericTag("aggregated");
var SUB_RESULT_TAG = numericTag("sub-result");
var CI_RETRY_TAG = numericTag("ci-retry");

// src/entrypoints/machinery/extract_directive.ts
import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

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

// src/entrypoints/machinery/extract_directive.ts
var ref = defineScript(import.meta.url);
var COMMAND_RE = new RegExp(`^\\/(${AGENT_NAME_PATTERN})$`);
function candidates(rawLine) {
  let line = rawLine.trim();
  if (!line)
    return [];
  line = line.replace(/^(?:[-*+]\s+|>\s*)+/, "");
  const variants = [line];
  if (line.startsWith("`") && line.endsWith("`") && line.length > 2) {
    variants.push(line.slice(1, -1).trim());
  }
  if (line.startsWith("/`") && line.endsWith("`") && line.length > 3) {
    variants.push("/" + line.slice(2, -1).trim());
  }
  return variants;
}
function extractDirective(output, defDir) {
  for (const rawLine of output.split(`
`)) {
    for (const candidate of candidates(rawLine)) {
      const match = COMMAND_RE.exec(candidate);
      if (match) {
        const agent = match[1];
        if (existsSync(join(defDir, `${agent}.md`)))
          return agent;
      }
    }
  }
  return "";
}
if (false)
  ;

// src/entrypoints/machinery/validate_pull_request.ts
var ref2 = defineScript(import.meta.url);
function log(message) {
  console.error(`[atomaton-validate-pr] ${message}`);
}
function pickDispatchedRun(runs, headSha, since) {
  const candidates = runs.filter((run) => run.event === "workflow_dispatch").filter((run) => run.head_sha === headSha).filter((run) => run.created_at >= since).sort((a, b) => a.created_at < b.created_at ? 1 : -1);
  const run = candidates[0];
  return run ? { id: run.id, status: run.status, conclusion: run.conclusion } : undefined;
}
function countPriorRetries(repo, number) {
  const { code, stdout } = gh("api", `repos/${repo}/issues/${number}/comments?per_page=100`);
  if (code)
    return 0;
  try {
    const comments = JSON.parse(stdout || "[]");
    return comments.filter((c) => CI_RETRY_TAG.has(c.body ?? "")).length;
  } catch {
    return 0;
  }
}
function reportFailure(repo, number, attempt, runUrl, summary, details = []) {
  const body = [
    LLM_CONTEXT_TAG.write("include"),
    CI_RETRY_TAG.write(attempt),
    `Atomaton: ${summary}`,
    ...details.length > 0 ? ["", ...details.map((detail) => `- ${detail}`)] : [],
    "",
    runUrl ? `Failing run: ${runUrl}` : ""
  ].filter(Boolean).join(`
`);
  const posted = gh("issue", "comment", number, "--repo", repo, "--body", body);
  if (posted.code)
    log(`WARN could not post the failure comment: ${posted.stderr}`);
}
function runCiAndWait(repo, workflow, branch, headSha, timeoutSeconds) {
  const since = new Date().toISOString();
  if (!dispatchWorkflow(`validate_pull_request: CI for ${branch}`, workflow, ["--repo", repo, "--ref", branch], log)) {
    process.exit(1);
  }
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    Bun.sleepSync(1e4);
    const listed = gh("api", `repos/${repo}/actions/runs?per_page=30&event=workflow_dispatch`).stdout;
    const { workflow_runs = [] } = JSON.parse(listed || "{}");
    const run = pickDispatchedRun(workflow_runs, headSha, since);
    if (!run)
      continue;
    if (run.status !== "completed")
      continue;
    const conclusion = run.conclusion ?? "";
    log(`dispatched run ${run.id} concluded ${conclusion}`);
    return { conclusion, runUrl: `https://github.com/${repo}/actions/runs/${run.id}` };
  }
  log(`no conclusion within ${timeoutSeconds}s`);
  return { conclusion: "", runUrl: "" };
}
function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      branch: { type: "string" },
      workflow: { type: "string" },
      "def-dir": { type: "string" },
      "deliverable-report": { type: "string" },
      "asked-by-person": { type: "string" },
      "timeout-seconds": { type: "string" }
    }
  });
  const repo = values.repo ?? "";
  const branch = values.branch ?? "";
  const workflow = values.workflow ?? "";
  const defDir = values["def-dir"] ?? "";
  if (!repo || !branch || !workflow || !defDir) {
    console.error("usage: validate_pull_request.ts --repo owner/name --number N --branch B --workflow W --def-dir DIR");
    process.exit(1);
  }
  const reportPath = values["deliverable-report"] ?? "";
  if (!reportPath) {
    console.error("usage: validate_pull_request.ts ... --deliverable-report FILE");
    process.exit(1);
  }
  if (!existsSync2(reportPath)) {
    log(`cannot validate: no deliverable report at ${reportPath}`);
    process.exit(1);
  }
  const deliverableProblems = readFileSync2(reportPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (deliverableProblems.length > 0) {
    log(`the deliverable is inconsistent (${deliverableProblems.length} problem(s)); CI will not be dispatched`);
  }
  const githubOutput = process.env.GITHUB_OUTPUT;
  const write = (line) => {
    if (githubOutput)
      appendFileSync2(githubOutput, `${line}
`);
  };
  const prJson = gh("api", `repos/${repo}/pulls/${values.number}`).stdout;
  const pr = JSON.parse(prJson || "{}");
  const headSha = pr.head?.sha ?? "";
  const baseRef = pr.base?.ref ?? "";
  if (!headSha) {
    log("could not read the pull request's head SHA");
    process.exit(1);
  }
  const required = readBranchRules(repo, baseRef);
  if (!required.known) {
    log(`cannot validate: ${required.why}`);
    process.exit(1);
  }
  const requiredContexts = required.contexts;
  log(`required contexts on ${baseRef}: ${requiredContexts.join(", ") || "(none)"}`);
  if (!required.enforceable) {
    log(`::notice::${required.why}. Atomaton enforces the CI result itself when merging.`);
  } else if (requiredContexts.length === 0) {
    log(`::warning::${baseRef} requires no status checks, so CI results gate nothing here. ` + "Import .github/atomaton/rulesets/main.json if that was not intended.");
  }
  const { conclusion, runUrl } = deliverableProblems.length > 0 ? { conclusion: "", runUrl: "" } : runCiAndWait(repo, workflow, branch, headSha, Number(values["timeout-seconds"] ?? "1800"));
  const priorRetries = countPriorRetries(repo, values.number ?? "");
  const prBody = gh("api", `repos/${repo}/pulls/${values.number}`, "--jq", ".body").stdout ?? "";
  const reviewerAgent = extractDirective(prBody, defDir);
  const engineerAgent = ORIGIN_AGENT_TAG.read(prBody) ?? "";
  const outcome = decideValidationOutcome({
    conclusion,
    reviewerAgent,
    engineerAgent,
    askedByPerson: (values["asked-by-person"] ?? "") === "true",
    priorRetries,
    deliverableProblems
  });
  const conclusionForContexts = contextsPassed(outcome.verdict) ? "success" : "failure";
  for (const check of requiredContexts.map((name) => ({ name, conclusion: conclusionForContexts }))) {
    const created = gh("api", "--method", "POST", `repos/${repo}/check-runs`, "-f", `name=${check.name}`, "-f", `head_sha=${headSha}`, "-f", "status=completed", "-f", `conclusion=${check.conclusion}`);
    if (created.code)
      log(`WARN could not write check "${check.name}": ${created.stderr}`);
    else
      log(`wrote check "${check.name}" as ${check.conclusion}`);
  }
  if (outcome.verdict !== "passed") {
    reportFailure(repo, values.number ?? "", priorRetries + 1, runUrl, outcome.summary, deliverableProblems);
  }
  write(`next_agent=${outcome.next?.agent ?? ""}`);
  write(`conclusion=${conclusion}`);
  write(`summary=${outcome.summary}`);
}
if (import.meta.main)
  main();
export {
  pickDispatchedRun,
  ref2 as ref
};

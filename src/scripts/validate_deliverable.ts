#!/usr/bin/env bun
/**
 * validate_deliverable.ts — checks that a tree's `.github/atomaton/` is internally
 * consistent, before a pull request that changes it can merge.
 *
 * ## The gap this closes
 *
 * Nothing checked the deliverable's own consistency at pull-request time. Atoma
 * resolves every name in an agent's `mcp_servers` against tools.yaml and aborts
 * the whole run before a single MCP server starts if one is missing — so that
 * failure surfaced AFTER the merge, on whoever triggered the next run, rather
 * than as a red check on the pull request that introduced it.
 *
 * `tests/contract/agent-definitions.test.ts` does check that one rule, but
 * adopters never receive it: `build-dist.ts` excludes `*.test.ts` by design. And
 * `config.yaml`'s `checks.atoma_runs.commands` ships empty, so an adopter's `atoma-check.yml`
 * runs nothing at all until they configure it — and whatever they put there is
 * their pipeline, not a place to hide this.
 *
 * ## Two owners, no reimplementation
 *
 * Agent definitions and tools.yaml are the core's formats, and the core already
 * validates them: `atoma validate --agent-def X.md --tools-file tools.yaml` checks
 * the parse, `mcp_servers` against the tools file, `knows_about` targets and their
 * `extra_body` reserved keys, and the hook paths the tools file
 * names — with the same code a run uses. This calls it once per agent definition
 * instead of parsing YAML again in TypeScript.
 *
 * config.yaml is delivery's own format and the core has never heard of it. That
 * half is `domain/deliverable-integrity.ts`, which likewise writes no new
 * validator: it runs the four resolvers that already exist, at pull-request time
 * instead of at merge, deploy or credential-handout time.
 *
 * ## Which tree
 *
 * `--root` is the tree to validate, and on a pull request it is a checkout of the
 * pull request's HEAD — the content that would merge. This script itself comes
 * from the default branch. The pull request's `.github/atomaton/` is data here and
 * never code: nothing under `--root` is executed, and the atoma binary is
 * downloaded by the workflow rather than taken from the tree being checked.
 *
 * ## Usage
 *
 *   validate_deliverable.ts [--root .] [--atoma atoma] [--report FILE]
 *
 * Exit codes are three-valued because the caller has to tell two failures apart:
 *
 *   0  the deliverable is consistent
 *   1  problems found — they are printed, and written to `--report` if given
 *   2  the check could not be performed (no such root, atoma would not run)
 *
 * `atoma-validate-pr.yml` treats 1 as a red check handed back to the engineer and
 * 2 as a broken job, because a validation that did not happen must not read as one
 * that passed. Run by hand — `bun run .github/scripts/validate_deliverable.ts` —
 * it is the same check the pull request is judged by.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { configProblems } from "../domain/deliverable-integrity.ts";
import { withEditableSource } from "../domain/generated-file-hint.ts";
import { reservedServerNames, toolsFileFrom, type ToolsSection } from "../domain/tools-file.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ValidateDeliverableArgs {
  /** Tree whose `.github/` is validated. Defaults to the working directory. */
  root?: string;
  /** The atoma binary. Defaults to `atoma` on PATH. */
  atoma?: string;
  /** File to write the problems into, one per line. Written empty when there are none. */
  report?: string;
}

export const ref = defineScript<ValidateDeliverableArgs>(import.meta.url);

/** Raised for the conditions that mean "not checked" rather than "not consistent". */
class CannotCheck extends Error {}

/**
 * The `✗ ...` lines `atoma validate` writes when it fails.
 *
 * Parsed rather than passed through whole because the rest of that output is a
 * ✓ line per thing that was fine, and this text ends up in a pull request comment
 * the engineer reads.
 *
 * A failure with no `✗` line is not silently dropped: the caller falls back to the
 * raw output, since that means the binary failed in some way `validate` does not
 * describe.
 */
export function validatorProblems(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("✗"))
    .map((line) => line.replace(/^✗\s*/, ""));
}

/** Run `atoma validate` against one agent definition and report what it found. */
function validateAgentDefinition(atoma: string, agentDef: string, toolsFile: string, label: string): string[] {
  const proc = Bun.spawnSync({
    cmd: [atoma, "validate", "--agent-def", agentDef, "--tools-file", toolsFile],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout ? proc.stdout.toString("utf8") : "";
  const stderr = proc.stderr ? proc.stderr.toString("utf8") : "";

  // A binary that could not be started at all is not a verdict about the
  // deliverable, and must not be reported as one.
  if (proc.exitCode === null) {
    throw new CannotCheck(`could not run \`${atoma} validate\`: ${stderr.trim() || "no output"}`);
  }
  if (proc.exitCode === 0) return [];

  // Relayed with the editable source named. `atoma validate` reports on the tools file
  // it was handed, which is generated from `tools.servers` -- so an adopter who opens
  // the file the message names and fixes it there loses the fix on the next build.
  // See `domain/generated-file-hint.ts`; most messages pass through untouched.
  const found = validatorProblems(`${stdout}\n${stderr}`);
  if (found.length > 0) return found.map((problem) => `${label}: ${withEditableSource(problem)}`);
  return [`${label}: \`atoma validate\` failed without saying why: ${stderr.trim() || stdout.trim() || "no output"}`];
}

/**
 * Write the tools file this tree's config describes, and return its path.
 *
 * Both halves come from the tree under review: the project's own `tools.servers`
 * from `.github/atomaton/config.yaml`, and the shipped servers from
 * `.github/atomaton-runtime/tools/defaults.yaml`. The hook base is that same runtime
 * directory, so the paths the core then checks for existence point at the scripts
 * this pull request would deploy — which is the thing being validated.
 *
 * Spelled out rather than taken from `domain/machinery-layout.ts`, like every other
 * path in this file and for the reason its header gives: these describe the tree
 * being judged, and a pull request must not be able to redirect the judging.
 */
function writeToolsFileFor(root: string): string {
  const atomaDir = join(root, ".github", "atomaton");
  const runtimeTools = join(root, ".github", "atomaton-runtime", "tools");

  const config = Bun.YAML.parse(readFileSync(join(atomaDir, "config.yaml"), "utf8")) as {
    tools?: ToolsSection;
  };
  const collisions = reservedServerNames(config.tools);
  if (collisions.length > 0) {
    throw new Error(`\`tools.servers\` may not be named ${collisions.join(", ")} — reserved by the core`);
  }
  const out = join(mkdtempSync(join(tmpdir(), "atoma-validate-")), "tools.yaml");
  writeFileSync(
    out,
    Bun.YAML.stringify(
      toolsFileFrom(config.tools, runtimeTools, join(runtimeTools, "defaults.yaml")),
      null,
      2,
    ),
  );
  return out;
}

/** Agent names in a deployed tree, one per `agent-definitions/<name>.md`. */
function agentNames(agentDir: string): string[] {
  if (!existsSync(agentDir)) return [];
  return readdirSync(agentDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length))
    .sort();
}

function workflowFiles(workflowDir: string): string[] {
  if (!existsSync(workflowDir)) return [];
  return readdirSync(workflowDir).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
}

function collect(root: string, atoma: string): string[] {
  if (!existsSync(root)) throw new CannotCheck(`--root ${root} does not exist`);

  const atomaDir = join(root, ".github", "atomaton");
  const agentDir = join(atomaDir, "agent-definitions");
  const configFile = join(atomaDir, "config.yaml");

  const names = agentNames(agentDir);
  const problems: string[] = [];

  // The config first: it is the file every workflow reads, and a tree without one
  // is a tree where nothing else is worth reporting in detail.
  if (!existsSync(configFile)) {
    problems.push(`${configFile} is missing. Every workflow reads it.`);
  } else {
    let config: unknown;
    try {
      config = Bun.YAML.parse(readFileSync(configFile, "utf8"));
    } catch (error) {
      problems.push(`${configFile} is not valid YAML: ${(error as Error).message}`);
    }
    if (config !== undefined) {
      problems.push(
        ...configProblems({
          config,
          agentNames: names,
          workflowFiles: workflowFiles(join(root, ".github", "workflows")),
        }),
      );
    }
  }

  // The core's half. Skipped only when there is nothing to hand it — which
  // `configProblems` has already reported as a problem of its own.
  //
  // The tools file is written here, from the config of the tree being validated, for
  // the same reason a run writes its own: it is not a file that exists. Validating a
  // shipped one would be validating what the template built months ago rather than
  // what this pull request's `tools.servers` says — which is how adding a server came
  // to pass validation here and then block every run.
  //
  // Into a temp directory, because `--root` on a pull request is the content under
  // review and nothing here may write to it.
  if (names.length > 0) {
    let toolsFile: string;
    try {
      toolsFile = writeToolsFileFor(root);
    } catch (error) {
      problems.push(`could not write the tools file from config.yaml: ${(error as Error).message}`);
      return problems;
    }
    for (const name of names) {
      problems.push(...validateAgentDefinition(atoma, join(agentDir, `${name}.md`), toolsFile, `${name}.md`));
    }
  }

  return problems;
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      root: { type: "string" },
      atoma: { type: "string" },
      report: { type: "string" },
    },
  });

  const root = values.root?.trim() || ".";
  const atoma = values.atoma?.trim() || "atoma";

  let problems: string[];
  try {
    problems = collect(root, atoma);
  } catch (error) {
    if (!(error instanceof CannotCheck)) throw error;
    console.error(`[atoma-validate-deliverable] cannot check: ${error.message}`);
    process.exit(2);
  }

  // Written even when empty. An absent report file means the step did not run,
  // which the caller must not be able to confuse with a clean one.
  if (values.report) writeFileSync(values.report, problems.map((problem) => `${problem}\n`).join(""));

  if (problems.length === 0) {
    console.log(`The deliverable in ${root} is internally consistent.`);
    return;
  }

  console.error(`${problems.length} problem(s) in ${root}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();

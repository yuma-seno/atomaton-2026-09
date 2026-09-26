#!/usr/bin/env bun
/**
 * report_config_findings.ts — open an issue for a defect atoma found in the tools
 * file it was handed, and put an agent on it.
 *
 * ## What it reads
 *
 * `atoma` checks the tools file before it starts any server, and writes one
 * machine-readable line per defect to the run log:
 *
 *     ATOMA_CONFIG_FINDING: kind=dead_guard severity=warn server=files_ro pattern=files_ro__* tools=read,grep
 *     ATOMA_CONFIG_FINDING: kind=duplicate_tool severity=error tool=read servers=files,files_ro
 *
 * The run carries on. Stopping would not close a guard that has stopped guarding --
 * it would only remove the agent's ability to repair the configuration, leaving a
 * person to do it by hand. So the defect is reported and the run continues, and
 * something has to read the line afterwards. That is this.
 *
 * ## Why the fields and not the sentence
 *
 * The fields are the contract; the English beside them is not. A caller that greps
 * the prose is a caller whose tooling atoma breaks by rewording a warning. So this
 * reads `kind=`, `severity=` and the fields beside them, and never the sentence.
 *
 * ## Why one issue per finding, deduplicated
 *
 * A defect in the tools file is not transient: every run until somebody fixes it
 * reports the same line. Opening an issue per run would bury the repository in
 * duplicates, and opening one per finding would lose the second defect behind the
 * first. So the finding's own fields are hashed into a marker, and an OPEN issue
 * carrying that marker is left alone. A closed one is not -- the defect came back,
 * and that is worth saying again.
 *
 * Usage:
 *   report_config_findings.ts --repo OWNER/REPO --logs-file FILE --agent NAME
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gh } from "../../adapters/github/gh.ts";
import { LLM_CONTEXT_TAG } from "../../adapters/github/tags.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ReportConfigFindingsArgs {
  repo: string;
  "logs-file": string;
  /** The agent to start on the issue, from `agents.on_config_finding`. */
  agent: string;
}

export const ref = defineScript<ReportConfigFindingsArgs>(import.meta.url);

/** The token a caller greps for. A constant in the core, and the same string here. */
const FINDING_PREFIX = "ATOMA_CONFIG_FINDING:";

/**
 * The marker that makes an issue findable, and the hash that makes it unique.
 *
 * A comment rather than a label: labels are a project's to name and a marker is
 * not, and a search for a comment body needs no label to exist first. The hash is
 * over the finding's own fields, so the same defect in the same place is one issue
 * and a different defect is another.
 */
export function findingMarker(fields: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(fields).digest("hex").slice(0, 16);
  return `<!-- atomaton:config-finding=${hash} -->`;
}

/**
 * Every finding in the log, as its field string.
 *
 * One line per finding, and the fields are everything after the prefix. Kept as the
 * raw field string rather than parsed into a shape: this module's job is to
 * recognise and deduplicate, and a parser here would be a second reader of a format
 * the core owns -- one that goes stale the moment a field is added.
 */
export function findingsIn(log: string): string[] {
  const found: string[] = [];
  for (const line of log.split("\n")) {
    const at = line.indexOf(FINDING_PREFIX);
    if (at === -1) continue;
    const fields = line.slice(at + FINDING_PREFIX.length).trim();
    if (fields) found.push(fields);
  }
  // Deduplicated within one run: the same defect reported by two servers, or by the
  // same server twice, is one thing to fix.
  return [...new Set(found)];
}

/** The issue title, from the fields. Short, and it names the kind and the subject. */
export function findingTitle(fields: string): string {
  const kind = /kind=(\S+)/.exec(fields)?.[1] ?? "unknown";
  const subject = /(?:server|tool)=(\S+)/.exec(fields)?.[1] ?? "";
  return subject ? `Config finding: ${kind} (${subject})` : `Config finding: ${kind}`;
}

function log(message: string): void {
  console.error(`[config-findings] ${message}`);
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      repo: { type: "string" },
      "logs-file": { type: "string" },
      agent: { type: "string" },
    },
  });

  const repo = values.repo ?? "";
  const logsFile = values["logs-file"] ?? "";
  const agent = (values.agent ?? "").trim();
  if (!repo || !logsFile) {
    console.error("usage: report_config_findings.ts --repo OWNER/REPO --logs-file FILE --agent NAME");
    process.exit(2);
  }

  // A missing log is not a finding. The run may have failed before atoma started,
  // and reporting that as a configuration defect would be inventing one.
  if (!existsSync(logsFile)) {
    log(`no log at ${logsFile}; nothing to report`);
    return;
  }

  const findings = findingsIn(readFileSync(logsFile, "utf8"));
  if (findings.length === 0) {
    log("no configuration findings");
    return;
  }
  log(`${findings.length} finding(s)`);

  // Required, and checked here rather than assumed. `configProblems` reports a
  // missing key on the pull request that would ship it, so reaching this with an
  // empty name means the config was changed outside a pull request -- and an issue
  // with no agent on it is the one outcome this whole path exists to avoid.
  if (!agent) {
    console.error(
      "::error::a configuration finding was reported but `agents.on_config_finding` is unset, " +
        "so no agent could be started. Set it in .github/atomaton/config.yaml.",
    );
    process.exit(1);
  }

  for (const fields of findings) {
    const marker = findingMarker(fields);
    // OPEN only. A closed issue carrying this marker means the defect was fixed and
    // has come back, which is worth saying again rather than suppressing.
    const existing = gh(
      "issue", "list", "--repo", repo, "--state", "open", "--search", marker,
      "--json", "number", "--jq", ".[0].number",
    );
    if (existing.code === 0 && existing.stdout.trim()) {
      log(`#${existing.stdout.trim()} already reports this finding; leaving it alone`);
      continue;
    }

    const body = [
      marker,
      "`atoma` found this defect in the tools file it was handed, reported it, and carried on.",
      "",
      "```",
      `${FINDING_PREFIX} ${fields}`,
      "```",
      "",
      "The fields are the contract and the sentence beside them is not, so this is the whole",
      "report. What each field means is in the core's own documentation.",
      "",
      "The run was not stopped, because stopping would not close a guard that has stopped",
      "guarding -- it would only remove the agent's ability to repair the configuration.",
    ].join("\n");

    const created = gh(
      "issue", "create", "--repo", repo,
      "--title", findingTitle(fields),
      "--body", body,
    );
    if (created.code !== 0) {
      console.error(`::warning::could not open an issue for this finding: ${created.stderr.trim()}`);
      continue;
    }
    const number = created.stdout.trim().split("/").pop() ?? "";
    log(`opened #${number} for ${fields}`);

    // The agent, on the issue, as a comment -- the same way a person asks. A
    // dispatch here would have to name the agent in a workflow input, which is the
    // hardcoding `agents` exists to remove; a comment is read by the entry workflow,
    // which resolves the name from the thread like every other run.
    //
    // Tagged `include`: this is the request the agent is being started on, so it is
    // the one comment on the issue it has to read.
    const asked = gh(
      "issue", "comment", number, "--repo", repo,
      "--body", `${LLM_CONTEXT_TAG.write("include")}\n/${agent}\n\nRepair the configuration defect reported above.`,
    );
    if (asked.code !== 0) {
      console.error(`::warning::opened #${number} but could not start ${agent} on it: ${asked.stderr.trim()}`);
    }
  }
}

if (import.meta.main) main();

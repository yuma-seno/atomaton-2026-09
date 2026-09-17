#!/usr/bin/env bun
/**
 * write_metrics_report.ts — read every stored session and write the report a person reads.
 *
 * Runs at the end of an agent run, where the branch is already being written to and the
 * cost is a few seconds on a job that took minutes. See `domain/metrics.ts` for what is
 * counted and `domain/metrics-report.ts` for why it is Markdown on `atomaton-data`.
 *
 * Usage:
 *   write_metrics_report.ts [--repo OWNER/REPO] [--stdout]
 *
 * `--stdout` prints the report instead of committing it, which is how to look at it
 * without touching the branch.
 *
 * ## Reading the sessions without a checkout
 *
 * `git show <ref>:<path>` per file, from the fetched ref. A worktree would put 25 MB on
 * disk to read files that are read once; and the current checkout at this point in a run
 * may hold the agent's own uncommitted work, which nothing here may disturb.
 */
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { ghPaginated, gitRun } from "../lib/gh.ts";
import { defineScript } from "./lib/script-ref.ts";
import { saveSession } from "./lib/atomaton-data.ts";
import { classifyShellAct } from "../domain/search-streak.ts";
import { CONFIG_FILE, SKILLS_DIR } from "../domain/machinery-layout.ts";
import { metricsOf, type ReportedProblem, type CallRecord, type SessionRecord, type TokenRecord } from "../domain/metrics.ts";
import { sessionEndedAt, within, type RunRecord, type Window } from "../domain/metrics-windows.ts";
import { renderReport } from "../domain/metrics-report.ts";

export const ref = defineScript(import.meta.url);

const BRANCH = "atomaton-data";

/** Where the report lives. Beside the data it is read from, not in the deliverable. */
export const REPORT_PATH = "metrics/report.md";

/**
 * Where the same data lives unsummarised.
 *
 * One row per session, with its runs and its call tallies. The report shows the slices
 * somebody decided were worth a heading; this is for the slice nobody has thought of,
 * which is where every finding this repository has made about its own agents came from.
 * Answering a new question should be a query rather than a change to this file.
 */
export const ROWS_PATH = "metrics/rows.json";

/** The rows, in the shape a one-off script would want them. */
function rowsOf(sessions: readonly SessionRecord[]): unknown[] {
  return sessions.map((s) => {
    const tools: Record<string, number> = {};
    const acts: Record<string, number> = {};
    for (const call of s.calls) {
      tools[call.tool] = (tools[call.tool] ?? 0) + 1;
      if (call.act) acts[call.act] = (acts[call.act] ?? 0) + 1;
    }
    return {
      path: s.path,
      agent: s.agent,
      messages: s.messages,
      calls: s.calls.length,
      failed: s.calls.filter((c) => c.failed).length,
      refused: s.calls.filter((c) => c.refused).length,
      skills: s.calls.flatMap((c) => (c.skill ? [c.skill] : [])),
      tools,
      acts,
      runs: s.runs,
    };
  });
}

function log(message: string): void {
  console.error(`[metrics] ${message}`);
}

/**
 * The agent a session belongs to, from its path.
 *
 * Both layouts end in the agent's name: `issue-7-engineer.json` and
 * `issue-7/engineer.json`, with `archive/engineer-1.json` beside the second. Unreadable
 * is `unknown` rather than a guess, so a layout nobody anticipated shows up as a row in
 * the report instead of being silently attributed to the wrong agent.
 */
export function agentOf(path: string): string {
  const file = path.split("/").pop() ?? "";
  const stem = file.replace(/\.json$/, "").replace(/-\d+$/, "");
  const match = /(?:^|-)(orchestrator|engineer|reviewer)$/.exec(stem);
  return match?.[1] ?? "unknown";
}

/**
 * Whether a result is the machinery refusing the call rather than a tool failing it.
 *
 * Three ways to be refused and they are one thing: a `before_tool` hook saying no, and
 * atoma's own denylist and allowlist. All three arrive as an error, which is how they
 * were counted as failures — so the report said `filesystem__search_files` fails 97.7%
 * of the time, when what it actually says is that a denylist works 43 times out of 43.
 *
 * A guard doing its job is not a tool breaking, and a reader cannot act on the two the
 * same way. Checked before `looksFailed`, because every refusal also looks like one.
 */
function looksRefused(content: string): boolean {
  return (
    /blocked by hook|shell_guard:|Tool blocked/.test(content) ||
    /is blocked by denylist pattern/.test(content) ||
    /is not permitted by the allowlist/.test(content) ||
    // `close_issue` declining a human's issue. A guard of ours, matched on wording we
    // wrote ourselves, so unlike a general "looks like a refusal" rule it cannot
    // swallow a call the agent simply got wrong. Fourteen of these were counted as
    // failures, which read as a broken tool when it was the tool doing its job.
    /Refusing to close issue #[0-9]+: opened by a human/.test(content)
  );
}

/**
 * The problems a server reported alongside an answer it did give.
 *
 * A tool result can end with a block the server appended:
 *
 *     --- 1 problem reported by the 'search' server, not part of the answer above ---
 *     warning: reranking failed (EACCES); these results are first-stage ordered
 *
 * The call succeeded, so neither `looksFailed` nor `looksRefused` is true, and until
 * now nothing else looked either. Twenty-six of these sat in the recorded sessions;
 * six were an audit log writing to a path that did not exist, which went unnoticed for
 * weeks and took two control signals with it.
 *
 * Only lines after the marker are read. The same words can appear in an answer -- a
 * grep for "error:" returns lines beginning "error:" -- and counting those would fill
 * this with whatever the agents happened to be reading.
 */
function problemsIn(content: string): ReportedProblem[] {
  const marker = /^--- \d+ problems? reported by the '([^']+)' server/m.exec(content);
  if (!marker) return [];
  const server = marker[1]!;
  const out: ReportedProblem[] = [];
  for (const line of content.slice(marker.index).split("\n")) {
    const reported = /^(error|warning):\s*(.+)$/.exec(line.trim());
    if (reported) out.push({ server, problem: normaliseProblem(reported[2]!) });
  }
  return out;
}

/**
 * One problem, spelled the same way every time it happened.
 *
 * Without this the same fault splits across rows on whatever issue number, pull
 * request number or byte count it mentioned, and a fault reported forty times reads
 * as forty faults reported once -- which is exactly the shape that gets ignored.
 *
 * Truncated because some of these carry a whole query or a path list, and the tail is
 * never what identifies them.
 */
function normaliseProblem(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/#[0-9]+/g, "#N")
    .replace(/[0-9]{3,}/g, "N")
    .trim()
    .slice(0, 120);
}

/** Whether a tool result reads as a failure. A string match, and the report says so. */
function looksFailed(content: string): boolean {
  if (looksRefused(content)) return false;
  return /^\s*(Error|error):/.test(content) || /"status"\s*:\s*"(failed|error)"/.test(content);
}

function sessionFrom(path: string, raw: string): SessionRecord | undefined {
  let parsed: {
    messages?: { role?: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] }[];
    atomaton_runs?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    log(`${path} is not readable as JSON; skipping it`);
    return undefined;
  }
  const messages = parsed.messages ?? [];
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && typeof message.tool_call_id === "string") {
      results.set(message.tool_call_id, typeof message.content === "string" ? message.content : "");
    }
  }

  const calls: CallRecord[] = [];
  const agent = agentOf(path);
  for (const message of messages) {
    for (const call of (message.tool_calls ?? []) as { id?: string; function?: { name?: string; arguments?: string } }[]) {
      const tool = call.function?.name ?? "";
      if (!tool) continue;
      const result = results.get(call.id ?? "") ?? "";
      let skill: string | undefined;
      let act: CallRecord["act"];
      if (tool.endsWith("load_skill")) {
        try {
          skill = JSON.parse(call.function?.arguments ?? "{}").name;
        } catch {
          /* a malformed load_skill is counted as a call and named by no skill */
        }
      } else if (tool.endsWith("shell_execute")) {
        try {
          const command = JSON.parse(call.function?.arguments ?? "{}").command ?? "";
          act = shellAct(command);
        } catch {
          act = "other";
        }
      }
      calls.push({
        tool,
        agent,
        failed: looksFailed(result),
        refused: looksRefused(result),
        skill,
        act,
        problems: problemsIn(result),
      });
    }
  }
  // `atomaton_runs` is atoma's own, written from v0.1.28. Anything unreadable is no
  // runs rather than a failure: a session from before it is the normal case.
  const runs = Array.isArray((parsed as { atomaton_runs?: unknown }).atomaton_runs)
    ? ((parsed as { atomaton_runs: RunRecord[] }).atomaton_runs)
    : [];
  return { path, agent, messages: messages.length, calls, runs };
}

/**
 * What a shell command was doing.
 *
 * `classifyShellAct` already answers search/open/other for the search guard, and using
 * it here rather than a second classifier is the point: the report and the guard then
 * cannot disagree about what a search is. Editing and verifying are the two categories
 * the guard has no opinion about, so they are added on top.
 */
function shellAct(command: string): CallRecord["act"] {
  if (/>\s*[^\s|&>]+/.test(command) && !/>\s*\/dev\/null/.test(command)) return "edit";
  const head = command.trim().split(/\s*(?:\|\||&&|[;|])\s*/)[0] ?? "";
  const word = (head.trim().split(/\s+/).find((t) => t && !t.includes("=") && t !== "sudo" && t !== "time") ?? "")
    .split("/")
    .pop();
  if (word === "sed" && /\s-i\b/.test(command)) return "edit";
  if (/^(bun|npm|npx|pnpm|yarn|cargo|go|pytest|python3?|make|tsc|jest|vitest|mvn|gradle|dotnet)$/.test(word ?? "")) {
    return "verify";
  }
  const classified = classifyShellAct(command);
  return classified === "other" ? "other" : classified;
}

/** Every `_Tokens: N total (P prompt + C completion)_` line the agents have posted. */
function tokensReported(repo: string): TokenRecord[] {
  const comments = ghPaginated<{ body?: string; issue_url?: string; created_at?: string }>(
    "api",
    `repos/${repo}/issues/comments?per_page=100`,
  );
  const out: TokenRecord[] = [];
  for (const comment of comments) {
    const match = /_Tokens:\s*([\d,]+)\s*total\s*\(([\d,]+)\s*prompt\s*\+\s*([\d,]+)\s*completion\)_/.exec(
      comment.body ?? "",
    );
    if (!match) continue;
    const number = Number(/(\d+)$/.exec(comment.issue_url ?? "")?.[1] ?? 0);
    const toNumber = (s: string) => Number(s.replace(/,/g, ""));
    out.push({
      issue: number,
      total: toNumber(match[1]!),
      prompt: toNumber(match[2]!),
      completion: toNumber(match[3]!),
      // The comment's own timestamp, which is what puts these tokens in a window.
      at: comment.created_at,
    });
  }
  return out;
}

/** The tools and skills the repository offers, so the report can name what is unused. */
function declared(): { tools: string[]; skills: string[] } {
  const root = process.env.ATOMATON_MACHINERY_ROOT?.trim() || ".";
  const tools: string[] = [];
  const skills: string[] = [];
  try {
    // From the config, not from the generated tools file: that file is written per
    // run into the runner's temp directory and is gone by the time anything reads a
    // report. `tools.servers` is also where a person would go to act on being told a
    // server is unused, which is the only reason this list is in the report.
    const config = Bun.YAML.parse(readFileSync(`${root}/${CONFIG_FILE}`, "utf8")) as {
      tools?: { servers?: Record<string, unknown> };
    };
    tools.push(...Object.keys(config.tools?.servers ?? {}));
  } catch {
    log("could not read the tool servers from config.yaml; the report will not name unused tools");
  }
  const listed = gitRun("ls-files", `${root}/${SKILLS_DIR}`);
  for (const path of listed.stdout.split("\n")) {
    const match = /skills\/(.+)\.md$/.exec(path.trim());
    if (match?.[1]) skills.push(match[1]);
  }
  return { tools, skills };
}

/**
 * When each session file was last written, from the branch's own history.
 *
 * One `git log` over the whole branch rather than one per file: there are hundreds of
 * sessions, and a `git log` each would be hundreds of processes to answer a question
 * the branch answers once.
 *
 * This is the file's date, not the work's. It is used only to say when a problem was
 * last seen, where being a day out changes nothing, and deliberately not to place a
 * session in a dated window -- a window is about when the work ran, and a session
 * rewritten by a later run would move.
 */
function sessionDates(paths: readonly string[]): Map<string, string> {
  const wanted = new Set(paths);
  const out = new Map<string, string>();
  const log = gitRun("log", `origin/${BRANCH}`, "--name-only", "--format=%x00%aI", "--", "sessions");
  if (log.code !== 0) return out;
  let date = "";
  for (const line of log.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("\u0000")) {
      date = trimmed.slice(1);
      continue;
    }
    // Newest first, so the first sighting of a path is its latest write.
    if (trimmed && wanted.has(trimmed) && !out.has(trimmed)) out.set(trimmed, date);
  }
  return out;
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" }, stdout: { type: "boolean" } },
  });
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? "";

  if (gitRun("fetch", "origin", BRANCH).code !== 0) {
    log(`${BRANCH} does not exist yet; nothing to report on`);
    return;
  }
  const listed = gitRun("ls-tree", "-r", "--name-only", `origin/${BRANCH}`, "--", "sessions");
  const paths = listed.stdout.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".json"));

  const writtenAt = sessionDates(paths);

  const sessions: SessionRecord[] = [];
  for (const path of paths) {
    const shown = gitRun("show", `origin/${BRANCH}:${path}`);
    if (shown.code !== 0) continue;
    const record = sessionFrom(path, shown.stdout);
    if (record) sessions.push({ ...record, at: writtenAt.get(path) });
  }

  let tokens: TokenRecord[] = [];
  if (repo) {
    try {
      tokens = tokensReported(repo);
    } catch (error) {
      // The sessions are the report; the tokens are one section of it. A rate limit
      // should cost that section, not the whole thing.
      log(`could not read the reported tokens: ${(error as Error).message}`);
    }
  }

  const { tools, skills } = declared();
  const now = new Date();
  // One window is the same aggregation over fewer sessions. Placing a session by its
  // last run is what lets a tool that no longer exists fall out of the recent windows
  // without anything having to know it was retired.
  const forWindow = (window: Window) =>
    metricsOf(
      sessions.filter((s) => within(sessionEndedAt(s.runs), window, now)),
      tools,
      skills,
      // Filtered by the same window as the sessions. They used not to be, and every
      // window printed the all-time total under its own heading.
      tokens.filter((t) => within(t.at, window, now)),
    );
  const report = renderReport(metricsOf(sessions, tools, skills, tokens), forWindow, now);
  const runs = sessions.flatMap((s) => s.runs);
  log(`${sessions.length} sessions, ${runs.length} recorded runs, ${tokens.length} reporting tokens`);

  if (values.stdout) {
    console.log(report);
    return;
  }
  // Beside the report, and the reason it exists: the report answers the questions it
  // was built for, and this answers the ones nobody has asked yet. Every finding this
  // repository has made about its own agents came from a question of the second kind.
  if (!saveSession(ROWS_PATH, `${JSON.stringify(rowsOf(sessions), null, 2)}\n`, `atomaton: metric rows from ${sessions.length} sessions`)) {
    log("could not write the rows; the report is unaffected");
  }
  if (!saveSession(REPORT_PATH, report, `atomaton: metrics from ${sessions.length} sessions`)) {
    log("could not write the report; the run is unaffected");
  }
}

if (import.meta.main) main();

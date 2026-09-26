#!/usr/bin/env bun
/**
 * write_metrics_report.ts — read every stored session and write the report a person reads.
 *
 * Runs at the end of an agent run, where the branch is already being written to and the
 * cost is a few seconds on a job that took minutes. See `domain/record/metrics.ts` for what is
 * counted and `domain/record/metrics-report.ts` for why it is Markdown on `atomaton-data`.
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
import { readFileSync, readdirSync } from "node:fs";
import { ghPaginated, gitRun } from "../../adapters/github/gh.ts";
import { defineScript } from "./lib/script-ref.ts";
import { saveSession } from "./lib/atomaton-data.ts";
import { classifyShellAct } from "../../domain/work/search-streak.ts";
import { CONFIG_FILE, SKILLS_DIR } from "../../domain/machinery/machinery-layout.ts";
import { machineryPath } from "../../adapters/runner/machinery.ts";
import {
  metricsOf,
  type DeclaredServer,
  type CallRecord,
  type SessionRecord,
  type TokenRecord,
} from "../../domain/record/metrics.ts";
// What a refused call, a failed one and a server's report about itself look like in a
// session. They live in `domain/` because this is no longer their only reader: the
// result comment counts the same three out of the same sessions, and two spellings of
// "this call was refused" is two answers to one question.
import { looksFailed, looksRefused, problemsIn } from "../../domain/record/tool-trouble.ts";
// Whether a run left a report, asked of the session. Shared with `read_run_ending.ts`
// for the same reason as the three above: it decides a run's ending there and this
// report's "ran to an end without a report" here, and two spellings of one question
// is how the report came to call a silent run a success in the first place.
import { leftClosingReport } from "../../domain/record/closing-report.ts";
import type { Session } from "../../domain/work/session.ts";
import { sessionEndedAt, within, type RunRecord, type Window } from "../../domain/record/metrics-windows.ts";
import { renderReport } from "../../domain/record/metrics-report.ts";
import { parseTokenLine } from "../../domain/record/token-line.ts";

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
      // Here as well as in the report, because this file is for the question nobody
      // has asked yet and "which of these said nothing" is now askable of every row:
      // crossed against the agent, the tool mix, or the run length, without reparsing
      // 25 MB of sessions to ask it.
      reported: s.reported,
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
 * The agent a session belongs to, out of the session itself.
 *
 * `metadata.github_context.agent`, written by `reconcile_github_session.ts` and
 * `record_run_metadata.ts` and declared on `SessionGithubContext`. This used to regex
 * the FILENAME instead — `(?:^|-)(atomaton|engineer|reviewer)$` over the stem,
 * with the `(?:^|-)` there to straddle two path layouts (`issue-7-engineer.json` and
 * `issue-7/engineer.json`, both of which really do exist on the data branch) and the
 * allowlist there to tell an agent's name from an issue number in the flat one.
 *
 * Neither was needed, and the allowlist was harmful. Measured over all 392 stored
 * sessions: every one carries the field, and in every one it agrees with what the
 * regex derived. The document is parsed and in hand at the one call site. And which
 * agents exist is an adopter's to choose — a project that renames `engineer` had every
 * one of that agent's sessions reported as `unknown`, by a list in a metrics script.
 *
 * `unknown` now means what it says: a session with no attribution recorded in it.
 */
export function agentOf(session: { metadata?: { github_context?: { agent?: string } } }): string {
  return session.metadata?.github_context?.agent?.trim() || "unknown";
}

function sessionFrom(path: string, raw: string): SessionRecord | undefined {
  // `Session`, the shape `domain/work/session.ts` defines, rather than a narrowed copy
  // spelled here. The copy was fine while nothing else read this document; it stopped
  // being fine when `leftClosingReport` did, because a local shape is not something a
  // shared function can be handed.
  let parsed: Session;
  try {
    parsed = JSON.parse(raw) as Session;
  } catch {
    log(`${path} is not readable as JSON; skipping it`);
    return undefined;
  }
  const messages = parsed.messages ?? [];
  const results = new Map<string, string>();
  for (const message of messages) {
    const id = message.tool_call_id;
    if (message.role === "tool" && typeof id === "string") {
      results.set(id, typeof message.content === "string" ? message.content : "");
    }
  }

  const calls: CallRecord[] = [];
  const agent = agentOf(parsed);
  for (const message of messages) {
    for (const call of (message.tool_calls ?? []) as { id?: string; function?: { name?: string; arguments?: string } }[]) {
      const tool = call.function?.name ?? "";
      if (!tool) continue;
      const result = results.get(call.id ?? "") ?? "";
      let skill: string | undefined;
      let act: CallRecord["act"];
      if (tool.endsWith("load_skill")) {
        try {
          // `skill_name`, which is what the tool takes. This read `name`, the spelling
          // atoma#24 removed when it collapsed five aliases into the one the models
          // measurably reach for -- so from that release onwards every `load_skill`
          // call was counted and none was attributed to a skill, and the report's
          // "unused skills" section was answering from an empty list.
          skill = JSON.parse(call.function?.arguments ?? "{}").skill_name;
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
  // `atoma_runs` is atoma's own -- the core writes this key into the session document
  // (`RUNS_KEY` in its runner) from v0.1.28, so it keeps the core's name however this
  // project is spelled. A rename of the CONFIG keys `checks.atoma_runs` and
  // `deploy.atoma_runs` took this with them once, because the two are spelled alike and
  // nothing but this sentence says they are unrelated. The reader then found nothing and
  // every dated window in the report emptied, leaving only the all-time table -- the one
  // the windows exist to stop anybody reading as though it described now.
  //
  // Anything unreadable is no
  // runs rather than a failure: a session from before it is the normal case.
  const runs = Array.isArray((parsed as { atoma_runs?: unknown }).atoma_runs)
    ? ((parsed as { atoma_runs: RunRecord[] }).atoma_runs)
    : [];
  // Asked of the same document the calls above came out of, through the same function
  // `read_run_ending.ts` asks it with -- so what the report counts as silent and what
  // the result comment calls `no-report` cannot come apart. Nothing new is recorded
  // for it: every session ever stored carries the messages it is read from.
  return { path, agent, messages: messages.length, calls, runs, reported: leftClosingReport(parsed) };
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

/**
 * Every token line the agents have posted, from the comments themselves.
 *
 * The spelling is `token-line.ts`, shared with the script that writes it, because
 * the two run days apart and a line that no longer matches is not counted rather
 * than reported.
 */
function tokensReported(repo: string): TokenRecord[] {
  const comments = ghPaginated<{ body?: string; issue_url?: string; created_at?: string }>(
    "api",
    `repos/${repo}/issues/comments?per_page=100`,
  );
  const out: TokenRecord[] = [];
  for (const comment of comments) {
    const figures = parseTokenLine(comment.body ?? "");
    if (!figures) continue;
    const number = Number(/(\d+)$/.exec(comment.issue_url ?? "")?.[1] ?? 0);
    out.push({
      issue: number,
      ...figures,
      // The comment's own timestamp, which is what puts these tokens in a window.
      at: comment.created_at,
    });
  }
  return out;
}

/**
 * The skills a tree ships, under the names a run loads them by.
 *
 * From the filesystem rather than from git, which is the fix and not a preference.
 * `ATOMATON_MACHINERY_ROOT` points at `${RUNNER_TEMP}/atomaton-machinery` -- a release
 * zip unpacked beside the checkout, and not a git repository at all -- so the
 * `git ls-files` this used returned nothing on every run since the section was
 * written. Nothing said so: an empty list filtered to an empty list and printed as
 * `Every skill has been loaded at least once`, which is why a skill loaded zero times
 * could sit in the catalogue unnoticed.
 *
 * `undefined` when the directory is missing or holds no skill. A deployed tree always
 * ships some, so an empty answer is this looking in the wrong place rather than a
 * project without any, and the report says it could not check.
 */
export function skillsUnder(dir: string): string[] | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }).map(String);
  } catch {
    return undefined;
  }
  const skills = entries
    .filter((entry) => entry.endsWith(".md"))
    // `recursive` yields the platform's separator, and a skill is loaded by a name
    // with slashes in it -- `delivery/pipeline-setup`, on Windows too.
    .map((entry) => entry.replaceAll("\\", "/").slice(0, -".md".length))
    .sort();
  return skills.length === 0 ? undefined : skills;
}
/**
 * The tools and skills the repository offers, so the report can name what is unused.
 *
 * `undefined` rather than an empty list when a source could not be read. An empty list
 * filters to an empty list and reads as "nothing is unused", which is the answer this
 * gave for as long as the skill directory was being renamed underneath it.
 */
function declared(): { tools: DeclaredServer[] | undefined; skills: string[] | undefined } {
  let tools: DeclaredServer[] | undefined;
  try {
    // From the config, not from the generated tools file: that file is written per
    // run into the runner's temp directory and is gone by the time anything reads a
    // report. `tools.servers` is also where a person would go to act on being told a
    // server is unused, which is the only reason this list is in the report.
    const config = Bun.YAML.parse(readFileSync(machineryPath(CONFIG_FILE), "utf8")) as {
      tools?: { servers?: Record<string, unknown> };
    };
    // An empty `tools.servers` is ordinary -- a project that adds no server of its own
    // has none -- so this stays a list. Only the read failing above leaves it unknown.
    // With `unprefixed`, which decides whether a call can name this server at all.
    // Read here rather than guessed at from the calls: a bare tool name belongs to
    // some unprefixed server and never says which.
    tools = Object.entries(config.tools?.servers ?? {}).map(([name, server]) => ({
      name,
      unprefixed: (server as { unprefixed?: boolean } | null)?.unprefixed === true,
    }));
  } catch {
    log("could not read the tool servers from config.yaml; the report will not name unused tools");
  }
  const skillsDir = machineryPath(SKILLS_DIR);
  const skills = skillsUnder(skillsDir);
  if (skills === undefined) {
    log(`no skills found under ${skillsDir}; the report will say it could not check`);
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

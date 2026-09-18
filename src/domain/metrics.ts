/**
 * metrics.ts — what the stored sessions say about how the agents are being run.
 *
 * ## Reading rather than recording
 *
 * Nothing here asks for a new record to be kept. Every number below is already in
 * `atomaton-data`: a session holds every tool call an agent made, in order, with the
 * arguments it passed and the result it got back. Half the work turned out to be
 * reading what is there, and the week that followed proved it three times — the search
 * guard's threshold, the cause of a 6.4M-token run, and the finding that the
 * edit/verify loop does not occur at all were each read out of these files.
 *
 * That is also why sessions are kept permanently. An aggregate answers the
 * questions it was built to answer. The raw sessions answer the ones nobody has thought
 * of yet, and all three of those started as questions nobody had thought of.
 *
 * ## What is deliberately not here
 *
 * **Money.** Four providers, and only one of them reports a cost; a price table goes
 * quietly stale and then prints confident wrong numbers. Tokens are the axis instead:
 * measured, comparable across providers, and anybody who knows their own rate can
 * multiply. Cost display was removed elsewhere for the same reason.
 *
 * **Averages, where a distribution is the point.** One run spent 54M tokens. Any mean
 * containing it describes nothing; the percentiles say what a normal run costs and what
 * the tail looks like, separately.
 */

import type { RunRecord } from "./metrics-windows.ts";

/** One tool call, as the aggregation needs it. */
export interface CallRecord {
  tool: string;
  /** The agent that made it, from the session's own metadata. */
  agent: string;
  /** Whether the result came back as an error. */
  failed: boolean;
  /** For `atoma_builtin__load_skill`, the skill named. */
  skill?: string;
  /** For a shell call, what the command was doing. */
  act?: ShellAct;
  /** Whether a hook refused the call. */
  refused: boolean;
  /**
   * Problems the server reported alongside an answer it did give.
   *
   * The third state, and the one nothing was counting. `failed` is an error instead of
   * an answer and `refused` is a guard saying no; this is an answer that arrived worse
   * than it should have -- a search that came back in first-stage order because the
   * reranker would not load, a tool whose audit log went nowhere. The call succeeded,
   * so neither of the other two is true, so the report said nothing at all.
   *
   * Each entry is one reported line, normalised so the same problem does not split
   * across rows on an issue number.
   */
  problems?: ReportedProblem[];
}

/** One line a server reported alongside an answer, and the server that reported it. */
export interface ReportedProblem {
  /**
   * Read from the report block, not from the tool name.
   *
   * They differ. The reranker's complaints arrive on whatever call was in flight when
   * the search server noticed, so taking the name from the tool filed them under
   * `atoma_builtin` -- a server that has no reranker.
   */
  server: string;
  problem: string;
}

/** One problem a server kept reporting, and where it was last seen. */
export interface DegradedTally {
  problem: string;
  /** The server named in the report block, not guessed from the tool name. */
  server: string;
  /** Reports, which may be several within one session. */
  count: number;
  sessions: number;
  /**
   * The most recent session that carried it, by the date its file was written.
   *
   * This is the column to read first. A problem reported six times tells you nothing
   * on its own -- six times last week is a live fault, and six times in August is one
   * somebody already fixed. The op-log defect sat in this data for weeks and was found
   * by a person reading a session, which is the reading this column replaces.
   */
  lastSeen?: string;
}

/** What a shell command was doing, coarsely. The categories the guard proposals argue about. */
export type ShellAct = "search" | "open" | "edit" | "verify" | "other";

/** One stored session, reduced to what is counted. */
export interface SessionRecord {
  path: string;
  agent: string;
  messages: number;
  calls: CallRecord[];
  /**
   * What atoma recorded about the runs that wrote this session, oldest first.
   *
   * Empty for anything written before atoma v0.1.28, which is most of the history and
   * is why the report's windows fill in going forward rather than being backfilled.
   */
  runs: RunRecord[];
  /**
   * When this session was last written, from the commit that wrote it.
   *
   * Not used to place a session in a window -- that stays on the run records, which say
   * when the work happened rather than when the file was stored. It is here so a
   * problem a server keeps reporting can say when it was last seen, which is the only
   * thing that separates a live fault from one already fixed.
   */
  at?: string;
}

/**
 * One run's token usage, read from the result comment it posted.
 *
 * `at` is when that comment was posted, and it is here because without it the report
 * printed the same token totals under all four window headings -- the sessions were
 * filtered and the tokens were not, so "Last 7 days" claimed 116 million tokens over
 * five sessions. A number under a heading it does not belong to is worse than no
 * number: a reader has no way to see that it is wrong.
 *
 * Optional, because a record read before this field was captured has no time and must
 * not be silently placed in a window. `within` already excludes an absent time from
 * every bounded window and keeps it in all-time, which is exactly right here.
 */
export interface TokenRecord {
  issue: number;
  total: number;
  prompt: number;
  completion: number;
  /**
   * How much of `prompt` the provider served from its cache.
   *
   * `undefined` when it did not say, which is NOT zero: GitHub Copilot reports no
   * tokens at all, and every comment posted before Atoma recorded this lacks it.
   * Zero would read as "the cache is doing nothing" -- the one conclusion an absent
   * measurement must not be allowed to support, since it is also what a genuinely
   * broken cache looks like.
   */
  cached?: number;
  at?: string;
}

/** Everything the report is rendered from. */
export interface Metrics {
  sessions: number;
  messages: Distribution;
  byAgent: Tally[];
  byTool: FailureTally[];
  bySkill: Tally[];
  byAct: Tally[];
  /**
   * Declared servers that nothing called, or `undefined` when the declared list could
   * not be read. See `metricsOf` for why servers and not tools, and why the two states
   * are not the same answer.
   */
  neverUsedServers: string[] | undefined;
  /** Declared skills that nothing loaded, or `undefined` when the list could not be read. */
  neverLoaded: string[] | undefined;
  refusals: number;
  /** Answers that arrived degraded, worst-recurring first. See `DegradedTally`. */
  degraded: DegradedTally[];
  /** Every run every session recorded, flattened. Empty until atoma v0.1.28 wrote any. */
  runs: RunRecord[];
  tokens?: TokenSummary;
}

export interface Tally {
  name: string;
  count: number;
}

export interface FailureTally extends Tally {
  failed: number;
  /** Calls the machinery refused. A guard working, counted apart from a tool breaking. */
  refused: number;
}

export interface Distribution {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  total: number;
}

export interface TokenSummary {
  runs: number;
  total: number;
  perRun: Distribution;
  /** Prompt as a share of total, 0-1. Measured at 97-99%, which is the point. */
  promptShare: number;
  /**
   * The cached part of the prompt, over the runs that reported one.
   *
   * `undefined` when none did, and `runs` is carried so the share is never read as
   * covering more runs than it does. Averaging a missing figure in as zero would
   * make a provider that says nothing look like a cache that is missing everything,
   * and the number would move whenever the mix of providers moved.
   *
   * It is here because a cached prompt token costs between an eighth and a fiftieth
   * of a fresh one, and a run here is almost all prompt. The share is most of what
   * separates the token counts from the bill.
   */
  cached?: { runs: number; tokens: number; ofPrompt: number };
}

/**
 * A percentile, by the nearest-rank rule on a sorted copy.
 *
 * Not interpolated: these are counts of discrete things, and "the 90th run spent 90,000
 * tokens" is a sentence about a run that happened. An interpolated value is not.
 */
export function distributionOf(values: readonly number[]): Distribution {
  if (values.length === 0) return { p50: 0, p90: 0, p99: 0, max: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    total: values.reduce((sum, v) => sum + v, 0),
  };
}

function tally(names: readonly string[]): Tally[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Everything the report shows, from the sessions and what the runs reported.
 *
 * `declaredServers` and `declaredSkills` are what the repository offers, so the report can
 * name what is never used. That is the metric with a cost attached: a server's tools and
 * a skill's description are in the prompt of every single run, so something never used is
 * paid for every time and returns nothing.
 *
 * `undefined` for either list means it could not be read, which is NOT the same answer as
 * an empty list. They were the same for a while: the skill list is built by listing a
 * directory, the listing came back empty while that directory was being renamed, and the
 * report said every skill had been loaded. A skill nobody had ever loaded sat behind that
 * sentence. A check whose input is missing has to say so rather than pass.
 *
 * Servers rather than individual tools, because `tools.yaml` declares servers and only a
 * running server can list its tools. Comparing the declared names against call names
 * directly is what the first version did, and since a call is `filesystem__read_text_file`
 * and the declaration is `filesystem`, it reported every server as unused.
 */
export function metricsOf(
  sessions: readonly SessionRecord[],
  declaredServers: readonly string[] | undefined,
  declaredSkills: readonly string[] | undefined,
  tokens: readonly TokenRecord[],
): Metrics {
  const calls = sessions.flatMap((s) => s.calls);
  const byTool = new Map<string, FailureTally>();
  for (const call of calls) {
    const row = byTool.get(call.tool) ?? { name: call.tool, count: 0, failed: 0, refused: 0 };
    row.count += 1;
    if (call.failed) row.failed += 1;
    if (call.refused) row.refused += 1;
    byTool.set(call.tool, row);
  }

  // Counted per problem rather than per tool: the same fault appears under whichever
  // tool happened to be called when the server noticed it, and it is the fault that
  // gets fixed. `sessions` is a set because one run can report the same thing ten times
  // and that is one fault, not ten.
  const degraded = new Map<string, DegradedTally & { seen: Set<string> }>();
  for (const session of sessions) {
    for (const call of session.calls) {
      // A call that failed or was refused is already counted, and counting it again
      // here would make this section a second copy of those two. What belongs here is
      // the third state only: the call worked, and said it worked badly.
      if (call.failed || call.refused) continue;
      for (const { server, problem } of call.problems ?? []) {
        const key = `${server}\u0000${problem}`;
        const row =
          degraded.get(key) ?? { problem, server, count: 0, sessions: 0, seen: new Set<string>() };
        row.count += 1;
        row.seen.add(session.path);
        if (session.at && (row.lastSeen === undefined || session.at > row.lastSeen)) {
          row.lastSeen = session.at;
        }
        degraded.set(key, row);
      }
    }
  }

  const usedServers = new Set(calls.map((c) => c.tool.split("__")[0] ?? ""));
  const loaded = new Set(calls.flatMap((c) => (c.skill ? [c.skill] : [])));

  return {
    sessions: sessions.length,
    messages: distributionOf(sessions.map((s) => s.messages)),
    byAgent: tally(sessions.map((s) => s.agent)),
    byTool: [...byTool.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    bySkill: tally(calls.flatMap((c) => (c.skill ? [c.skill] : []))),
    byAct: tally(calls.flatMap((c) => (c.act ? [c.act] : []))),
    neverUsedServers: declaredServers?.filter((s) => !usedServers.has(s)).sort(),
    neverLoaded: declaredSkills?.filter((s) => !loaded.has(s)).sort(),
    refusals: calls.filter((c) => c.refused).length,
    degraded: [...degraded.values()]
      .map(({ seen, ...row }) => ({ ...row, sessions: seen.size }))
      // Recency first: a fault last seen today outranks a louder one from August.
      .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || b.count - a.count),
    runs: sessions.flatMap((s) => s.runs),
    tokens: tokens.length === 0 ? undefined : tokenSummary(tokens),
  };
}

function tokenSummary(tokens: readonly TokenRecord[]): TokenSummary {
  const total = tokens.reduce((sum, t) => sum + t.total, 0);
  const prompt = tokens.reduce((sum, t) => sum + t.prompt, 0);
  // Only the runs that reported a cache figure, and their own prompt as the
  // denominator -- so the share is of what those runs sent, not of everything.
  const reported = tokens.filter((t) => t.cached !== undefined);
  const cachedPrompt = reported.reduce((sum, t) => sum + t.prompt, 0);
  const cachedTokens = reported.reduce((sum, t) => sum + (t.cached ?? 0), 0);
  return {
    runs: tokens.length,
    total,
    perRun: distributionOf(tokens.map((t) => t.total)),
    promptShare: total === 0 ? 0 : prompt / total,
    cached:
      reported.length === 0
        ? undefined
        : {
            runs: reported.length,
            tokens: cachedTokens,
            ofPrompt: cachedPrompt === 0 ? 0 : cachedTokens / cachedPrompt,
          },
  };
}

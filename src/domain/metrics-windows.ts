/**
 * metrics-windows.ts — the same questions asked of different stretches of time.
 *
 * A single all-time table answers "what has this repository ever done" and nothing about
 * whether last week was better than the week before. That second question is the one
 * dogfooding exists to ask, so the report shows the same tables over several windows.
 *
 * ## What a window can be cut by
 *
 * `atoma_runs` in each session, written by atoma from v0.1.28: when a run started, when
 * it ended, why it ended. Before that, sessions carried no time at all — a session
 * records what was said and nothing about the saying of it.
 *
 * So the windows fill in from the first run after that version and not before. There is
 * no retrofit: git's commit dates on `atoma-data` looked like a free answer and are not,
 * because restoring the sessions that a prune had removed rewrote 97 of them to the same
 * afternoon. A date that is wrong is worse here than a date that is missing, because a
 * window silently containing the wrong runs reads exactly like one containing the right
 * ones.
 */

/** One run, as the windows need it. Mirrors atoma's `RunRecord`. */
export interface RunRecord {
  started: string;
  ended: string;
  seconds: number;
  /** `completed`, `iterations`, `runtime`, `stopped` or `failed`. */
  ended_because: string;
  messages: number;
}

/** A stretch of time the report covers. */
export interface Window {
  label: string;
  /** Days back from now, or `undefined` for everything. */
  days?: number;
}

/**
 * The windows the report shows, widest last.
 *
 * Seven and thirty because those are the two questions anybody actually asks — "is this
 * week worse" and "is this month worse". A year because a template is adopted and then
 * left alone, and the question after a quiet stretch is whether anything drifted. All
 * time stays because for a while it is the only one with anything in it, and because it
 * is the only honest place for a session that predates any record of when it ran.
 *
 * What a window is for beyond trend: a tool that no longer exists drops out of the
 * recent ones on its own. `shell__terminal_operate` was 333 failures of a server this
 * repository stopped running, sitting in the same table as tools it still uses and
 * reading as though something were broken. Nothing has to detect a retired tool — time
 * removes it, and an agent that invents a tool name still shows up, which a
 * retired-tool rule would have hidden.
 */
export const WINDOWS: Window[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last year", days: 365 },
  { label: "All time" },
];

/** Whether a moment falls inside a window, given when the report is being made. */
export function within(ended: string | undefined, window: Window, now: Date): boolean {
  if (window.days === undefined) return true;
  if (ended === undefined) return false;
  const at = Date.parse(ended);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= window.days * 86_400_000;
}

/**
 * When a session last ran, or `undefined` if it never said.
 *
 * The last run rather than the first: a session resumed over a fortnight is one file,
 * and placing it by when it started would put work done today in a window that closed a
 * week ago. Neither answer is right for a session spread across a month, and the recent
 * one is the one somebody reading "last 7 days" means.
 *
 * `undefined` for every session written before atoma v0.1.28, which is most of the
 * history. Those appear under all time and nowhere else, which is exactly what is known
 * about them.
 */
export function sessionEndedAt(runs: readonly RunRecord[]): string | undefined {
  return runs.length === 0 ? undefined : runs[runs.length - 1]?.ended;
}

/** How runs ended, most common first. The rows that are not `completed` are the point. */
export function endings(runs: readonly RunRecord[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.ended_because, (counts.get(run.ended_because) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The share of runs that ended for a reason other than finishing.
 *
 * Named for what it measures rather than for `ended_because`, because the number people
 * want is "how often does something give up", and every value except `completed` is an
 * instance of that.
 */
export function gaveUpShare(runs: readonly RunRecord[]): number {
  if (runs.length === 0) return 0;
  return runs.filter((r) => r.ended_because !== "completed").length / runs.length;
}

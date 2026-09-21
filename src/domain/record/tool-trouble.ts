/**
 * tool-trouble.ts — what the tools did to a run, counted out of its own session.
 *
 * Two things happen to a run that nothing outside that run ever sees. A server can
 * append a block to a result saying it answered worse than it should have:
 *
 *     --- 1 problem reported by the 'search' server, not part of the answer above ---
 *     warning: could not preload the reranker (EACCES), results are first-stage ordered
 *
 * And a call can come back refused by a guard, or failed outright. Both sit in the
 * session and nowhere else — the next run reads the thread rather than the session,
 * and a person reads the comment.
 *
 * Measured over the 396 stored sessions (#940): 30 runs carried a problem a server
 * reported about itself and 3 of them mentioned it in the report; 107 carried a
 * refused or errored call and 33 mentioned it. `prompt-template.md` asks for exactly
 * this, by name, and asking produced 10%. The reranker case above is what that costs:
 * every search answered in first-stage order for weeks, and two releases went out
 * before anybody noticed, because the only run that saw it filed a normal report.
 *
 * So the machine counts it, and says the count. Like `tool-tally.ts`, deliberately not
 * a report: it does not summarise the problems, name a cause, or claim the agent left
 * them out. That last one is not knowable from here — whether a report "accounts for"
 * a problem is a question about prose, and every way of answering it from this side is
 * a keyword guess that fails silently in both directions (the agent that paraphrased
 * is marked as silent; the agent that happened to write the word "search" is marked as
 * having explained). A count that is sometimes redundant is cheaper than a warning
 * that is sometimes wrong, so the count goes out unconditionally when it is non-zero.
 */
import type { Session } from "../work/session.ts";
import type { ReportedProblem } from "./metrics.ts";

/** How many servers to name before the rest become a count. */
const NAMED = 3;

/**
 * Whether a result is the machinery refusing the call rather than a tool failing it.
 *
 * Three ways to be refused and they are one thing: a `before_tool` hook saying no, and
 * atoma's own denylist and allowlist. All three arrive as an error, which is how they
 * were counted as failures — so the metrics report said `filesystem__search_files`
 * fails 97.7% of the time, when what it actually says is that a denylist works 43
 * times out of 43.
 *
 * A guard doing its job is not a tool breaking, and a reader cannot act on the two the
 * same way. Checked before `looksFailed`, because every refusal also looks like one.
 */
export function looksRefused(content: string): boolean {
  return (
    /blocked by hook|shell_guard:|Tool blocked/.test(content) ||
    /is blocked by denylist pattern/.test(content) ||
    /is not permitted by the allowlist/.test(content) ||
    // `close_issue` declining a human's issue. A guard of ours, matched on wording we
    // wrote ourselves, so unlike a general "looks like a refusal" rule it cannot
    // swallow a call the agent simply got wrong. Fourteen of these were counted as
    // failures, which read as a broken tool when it was the tool doing its job.
    //
    // Nothing emits this any more: the tool now posts a comment asking the issue's
    // author to close it and reports success, because a refusal handed to an agent at
    // the end of its run came back out in the report. The pattern stays for the
    // sessions already recorded, which the metrics report still reads.
    /Refusing to close issue #[0-9]+: opened by a human/.test(content)
  );
}

/** Whether a tool result reads as a failure. A string match, and the report says so. */
export function looksFailed(content: string): boolean {
  if (looksRefused(content)) return false;
  return /^\s*(Error|error):/.test(content) || /"status"\s*:\s*"(failed|error)"/.test(content);
}

/**
 * The problems a server reported alongside an answer it did give.
 *
 * The call succeeded, so neither `looksFailed` nor `looksRefused` is true, and for a
 * long time nothing else looked either. Twenty-six of these sat in the recorded
 * sessions; six were an audit log writing to a path that did not exist, which went
 * unnoticed for weeks and took two control signals with it.
 *
 * Only lines after the marker are read. The same words can appear in an answer — a
 * grep for "error:" returns lines beginning "error:" — and counting those would fill
 * this with whatever the agents happened to be reading.
 */
export function problemsIn(content: string): ReportedProblem[] {
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
 * as forty faults reported once — which is exactly the shape that gets ignored.
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

/**
 * `Counted from the session: 2 problems a server reported about itself (\`search\`), 5 refused or errored tool calls.`
 *
 * `from` is where this run's own messages begin. A session accumulates across runs, so
 * counting from the top puts the previous run's trouble under this run's comment —
 * the defect `lastAgentText` was given the same boundary for, and harder to see here,
 * because a wrong count still looks exactly like a count. No boundary, no line: a
 * number that may belong to somebody else is worse than no number.
 *
 * `undefined` when there is nothing to say, which is the ordinary case. The comment
 * goes out either way; this is an addition to it.
 */
export function toolTroubleLine(session: Session | undefined, from: number | undefined): string | undefined {
  if (from === undefined || !Number.isFinite(from)) return undefined;
  const messages = session?.messages ?? [];
  const servers = new Map<string, number>();
  let problems = 0;
  let stopped = 0;
  for (let i = Math.max(0, from); i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "tool") continue;
    // A result that arrived as content blocks is read as no text rather than
    // stringified: the block form carries a picture, and `[object Object]` matches
    // none of the patterns above anyway.
    const content = typeof message.content === "string" ? message.content : "";
    for (const { server } of problemsIn(content)) {
      problems += 1;
      servers.set(server, (servers.get(server) ?? 0) + 1);
    }
    // One result per call, so this counts calls. Refusals and failures are one number
    // here although the metrics report separates them, and the question is what makes
    // the difference: there, it is "is this tool broken", where a guard doing its job
    // must not count; here, it is "did this run hit something the report should have
    // carried", and a guard that refused the agent is equally that.
    if (looksRefused(content) || looksFailed(content)) stopped += 1;
  }
  if (problems === 0 && stopped === 0) return undefined;

  const parts: string[] = [];
  if (problems > 0) {
    // Named, because the server is the thing a person would open an issue about, and
    // it is not derivable from the tool that carried the report: the reranker's
    // complaints arrive on whatever call was in flight when the search server noticed.
    const ranked = [...servers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = ranked.slice(0, NAMED).map(([server]) => `\`${server}\``);
    const rest = ranked.length - shown.length;
    if (rest > 0) shown.push(`and ${rest} other server${rest === 1 ? "" : "s"}`);
    const said = servers.size === 1 ? "a server reported about itself" : "servers reported about themselves";
    parts.push(`${problems} problem${problems === 1 ? "" : "s"} ${said} (${shown.join(", ")})`);
  }
  if (stopped > 0) parts.push(`${stopped} refused or errored tool call${stopped === 1 ? "" : "s"}`);

  return `Counted from the session: ${parts.join(", ")}.`;
}

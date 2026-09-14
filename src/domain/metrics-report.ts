/**
 * metrics-report.ts — the metrics as something a person reads.
 *
 * Markdown, because it is rendered where it is stored and needs nothing installed to
 * read. It lives on `atoma-data` rather than in the repository: the working tree is the
 * deliverable, and a file that changes on every run would arrive in every pull request
 * for somebody to read past. Its own commit history is the trend line — the same
 * property that makes a diff of last week against this week free.
 *
 * ## Everything is asked of a window
 *
 * An all-time table says what this repository has ever done and nothing about whether
 * last week was worse. It also keeps answering for a world that no longer exists:
 * `shell__terminal_operate` sat in the tools table with 333 failures, from a server this
 * repository stopped running, reading as though something were broken right now.
 *
 * Windows fix both, and nothing has to detect a retired tool. Time removes it, while an
 * agent that invents a tool name still appears — which a retired-tool rule would have
 * hidden, since a hallucinated name and a deleted one look identical.
 *
 * A session is placed by the last run that wrote it, which atoma records from v0.1.28.
 * Sessions older than that appear under all time and nowhere else, because that is all
 * that is known about them.
 *
 * ## What each section is for
 *
 * Every section answers a question somebody actually has, and the ones that cost money
 * come first. The section that names **nothing** — a server never called, a skill never
 * loaded — is the one worth reading most often: a server's tools and a skill description
 * sit in the prompt of every run, so something never used is paid for every time and
 * returns nothing.
 */
import type { Distribution, Metrics, Tally } from "./metrics.ts";
import {
  WINDOWS,
  endings,
  gaveUpShare,
  within,
  type RunRecord,
  type Window,
} from "./metrics-windows.ts";

/** Thousands separators, because these numbers are read rather than computed with. */
function n(value: number): string {
  return value.toLocaleString("en-US");
}

/** "1 run", "2 runs" — the report is read by a person, and a count of one must not be plural. */
function plural(value: number, singular: string, pluralWord: string): string {
  return `${n(value)} ${value === 1 ? singular : pluralWord}`;
}

function distributionRow(label: string, d: Distribution): string {
  return `| ${label} | ${n(d.p50)} | ${n(d.p90)} | ${n(d.p99)} | ${n(d.max)} | ${n(d.total)} |`;
}

function tallyTable(rows: readonly Tally[], of: number, what: string, unit: string): string[] {
  if (rows.length === 0) return [`No ${what} recorded.`];
  const out = [`| ${what} | ${unit} | share |`, "| --- | ---: | ---: |"];
  for (const row of rows) {
    const share = of === 0 ? 0 : Math.round((row.count / of) * 1000) / 10;
    out.push(`| \`${row.name}\` | ${n(row.count)} | ${share}% |`);
  }
  return out;
}

/**
 * How the runs went, over each window.
 *
 * A window with nothing in it is a row rather than a gap: a missing line reads as
 * "nothing went wrong last week", and an empty one reads as what it is.
 */
function runSection(runs: readonly RunRecord[], now: Date): string[] {
  const out = ["## Runs", ""];
  if (runs.length === 0) {
    out.push(
      "No run has recorded itself yet. Atoma writes `atoma_runs` into a session from " +
        "v0.1.28; sessions older than that carry no times, and there is no way to backfill " +
        "one that would not be a guess.",
      "",
    );
    return out;
  }

  out.push("| window | runs | gave up | median seconds | longest |");
  out.push("| --- | ---: | ---: | ---: | ---: |");
  for (const window of WINDOWS) {
    const inside = runs.filter((run) => within(run.ended, window, now));
    if (inside.length === 0) {
      out.push(`| ${window.label} | 0 | — | — | — |`);
      continue;
    }
    const seconds = inside.map((r) => r.seconds).sort((a, b) => a - b);
    const median = seconds[Math.floor(seconds.length / 2)] ?? 0;
    const share = Math.round(gaveUpShare(inside) * 1000) / 10;
    const longest = seconds[seconds.length - 1] ?? 0;
    out.push(`| ${window.label} | ${n(inside.length)} | ${share}% | ${n(median)} | ${n(longest)} |`);
  }
  out.push("");
  out.push(
    "**Gave up** is every ending that is not `completed` — a ceiling reached, a person " +
      "asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding " +
      "the run should not continue, which is worth watching whether or not it was right.",
  );
  out.push("");
  out.push("| ended because | runs |");
  out.push("| --- | ---: |");
  for (const row of endings(runs)) out.push(`| \`${row.name}\` | ${n(row.count)} |`);
  out.push("");
  return out;
}

/** One window's worth of everything else. */
function windowSection(label: string, metrics: Metrics): string[] {
  const out = [`## ${label}`, ""];
  if (metrics.sessions === 0) {
    out.push("No session ran in this window.", "");
    return out;
  }

  out.push(`${plural(metrics.sessions, "session", "sessions")}.`);
  out.push("");

  if (metrics.tokens) {
    const t = metrics.tokens;
    out.push(
      `**${n(t.total)} tokens** over ${plural(t.runs, "run", "runs")} that reported them, ` +
        `**${Math.round(t.promptShare * 1000) / 10}% of it prompt** — what the agents were ` +
        "made to read, not what they wrote. Anything spent on making runs cheaper belongs " +
        "on that side. No money here, deliberately: of the four providers only one reports " +
        "a cost, and a price table goes quietly stale and then prints confident wrong " +
        "numbers.",
    );
    out.push("");
  }
  out.push("| | p50 | p90 | p99 | max | total |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  if (metrics.tokens) out.push(distributionRow("tokens per run", metrics.tokens.perRun));
  out.push(distributionRow("messages per session", metrics.messages));
  out.push("");

  out.push(...tallyTable(metrics.byAgent, metrics.sessions, "agent", "sessions"));
  out.push("");

  if (metrics.byTool.length > 0) {
    out.push(
      "**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard " +
        "working is not a tool breaking, and a reader cannot act on the two the same way, so " +
        "they are counted apart. **Failed** is everything else that came back as an error, " +
        "by string match, so it is an estimate.",
    );
    out.push("");
    out.push("| tool | calls | failed | refused | failure rate |");
    out.push("| --- | ---: | ---: | ---: | ---: |");
    for (const row of metrics.byTool) {
      const rate = row.count === 0 ? 0 : Math.round((row.failed / row.count) * 1000) / 10;
      out.push(
        `| \`${row.name}\` | ${n(row.count)} | ${n(row.failed)} | ${n(row.refused)} | ${rate}% |`,
      );
    }
    out.push("");
  }

  out.push(
    "What the agents do when they reach for a shell. `search` without a matching `open` is " +
      "the shape that produced this project's most expensive runs; `edit` against `verify` " +
      "is the shape that turned out not to occur at all.",
  );
  out.push("");
  out.push(...tallyTable(metrics.byAct, metrics.byAct.reduce((s, a) => s + a.count, 0), "act", "calls"));
  out.push("");
  out.push(...tallyTable(metrics.bySkill, metrics.bySkill.reduce((s, k) => s + k.count, 0), "skill", "loads"));
  out.push("");
  return out;
}

/**
 * The report.
 *
 * `now` is passed in rather than read from the clock so the same input renders the same
 * output — which is what lets a test assert on it, and what keeps a rerun that changed
 * nothing from producing a commit. It is also what the windows are measured back from.
 *
 * `forWindow` computes one window's metrics rather than this file slicing them: what
 * belongs to a window is a question about sessions, and `metrics.ts` owns those.
 */
export function renderReport(
  all: Metrics,
  forWindow: (window: Window) => Metrics,
  now: Date,
): string {
  const out: string[] = [];

  out.push("# Agent metrics");
  out.push("");
  out.push(
    "Read from the sessions stored on this branch. Nothing here is recorded specially: " +
      "every number is something the agents already wrote down while working.",
  );
  out.push("");
  out.push(`Generated ${now.toISOString().slice(0, 10)}.`);
  out.push("");
  // Without this, a reader comparing "Last year: 5 sessions" against "All time: 360"
  // concludes the project went quiet. It did not: a session reaches a window through
  // the run records it carries, and runs were only recorded from the release that
  // added them. The windows fill in on their own, and the sentence can go when they
  // have. Better an explained gap than a silent one that reads as a finding.
  out.push(
    "A session appears in a dated window only if it recorded when its runs ended. " +
      "Sessions from before run recording existed are counted under All time alone, " +
      "so the dated windows are thinner than the project was — that gap closes as new " +
      "sessions arrive, not by anything changing here.",
  );
  out.push("");
  out.push(...runSection(all.runs, now));

  for (const window of WINDOWS) out.push(...windowSection(window.label, forWindow(window)));

  out.push("## Never used");
  out.push("");
  out.push(
    "Over all time, because something used once a year is still used. Each of these sits " +
      "in the prompt of every run and returns nothing.",
  );
  out.push("");
  out.push(
    all.neverUsedServers.length === 0
      ? "Every declared server has been called at least once."
      : "Servers never called:\n\n" + all.neverUsedServers.map((t) => `- \`${t}\``).join("\n"),
  );
  out.push("");
  out.push(
    all.neverLoaded.length === 0
      ? "Every skill has been loaded at least once."
      : "Skills never loaded:\n\n" + all.neverLoaded.map((s) => `- \`${s}\``).join("\n"),
  );
  out.push("");

  return out.join("\n");
}

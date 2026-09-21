/**
 * tool-output.ts — how much of a tool's result may enter the session, and which
 * part of it survives when there is too much.
 *
 * ## Why one place
 *
 * A tool result is not a return value that gets read once and discarded. It joins
 * the session on the `atomaton-data` branch and is **resent on every later inference
 * in that session, across runs**. So a single large result is not a one-off cost:
 * it is a rent charged for the rest of the issue's life.
 *
 * The caps were four numbers in three units, none of them related to the thing
 * that decides whether a request succeeds at all — the model's context window:
 *
 *   shell_execute          1,000,000 BYTES   (~250k tokens)
 *   web_fetch                 60,000 chars   (~15k tokens)
 *   github__get_pr_diff       50,000 chars   (~12.5k tokens)
 *   github__search_code       50,000 chars   (~12.5k tokens)
 *   everything else           no cap at all
 *
 * `shell_execute`'s was the outlier by twenty times, and on its own it exceeds a
 * 200k window — measured: the largest single tool result in this repository's
 * stored sessions is ~206k tokens, and one session reached ~672k of which the
 * conversation was 9k.
 *
 * ## Truncation is the second-best answer
 *
 * A cap loses information. A PROJECTION does not: `github__get_check_runs`
 * returned 24,954 bytes of REST for eight check runs, of which ~18k was the same
 * GitHub App description repeated once per run, and the four fields an agent can
 * act on came to 1,363 bytes. Eighteen times smaller, nothing lost.
 *
 * So: project first, cap second. This module is the cap; the projections live
 * with the tools that produce them.
 */

/**
 * The most one tool result may contribute, in characters.
 *
 * Characters rather than tokens because no tokenizer is available here, and
 * rather than bytes because a byte cap on UTF-8 cuts multi-byte text at a
 * fraction of the length it promises — this repository's issues are part
 * Japanese, where a byte budget delivers a third of its nominal size.
 *
 * 50,000 was already the value two tools used, and it is about 12.5k tokens: a
 * tenth of the smallest context window worth designing for (128k). A tool call
 * that wants more than a tenth of the window is a tool call that should have
 * returned less.
 */
export const TOOL_OUTPUT_BUDGET = 50_000;

/**
 * The cap the core is ASKED to apply to the servers this repository writes.
 *
 * ## Why it is passed at all
 *
 * atoma caps every tool result too, on the client, where it covers a server nobody
 * here wrote. Its default is also 50,000 — and that is a coincidence rather than an
 * agreement: this budget came from the two tools already using the number, atoma's
 * from `domain::tool_output::DEFAULT_MAX_OUTPUT_CHARS`. While the two match, atoma's
 * cap on these servers never fires, so nothing states the relationship and nothing
 * would report it breaking. `domain/machinery/tools-file.ts` writes this into every
 * shipped server's `max_output_chars`, which turns an assumption into a line.
 *
 * ## Why it sits ABOVE the budget rather than at it
 *
 * The two caps do different jobs and count different strings. The budget above is
 * what a server may spend on CONTENT, after projecting. atoma counts the text that
 * arrives, which for a server returning JSON is that content escaped and inside an
 * envelope.
 *
 * Measured: `shell_execute` on a `git log -p` long enough to fill both streams
 * spends exactly 50,000 characters of budget and returns 51,412 — the envelope and
 * the escaped newlines are 1,412 of it. Across the 39 files in this repository over
 * 20KB the worst was 53,879. So a backstop AT 50,000 cuts results this repository
 * had already cut correctly: a second note on one result, and the middle taken out
 * of output whose two ends were deliberately chosen.
 *
 * Doubling is where that stops being a measurement and becomes arithmetic. JSON
 * escaping is at most two characters per character of text — a budget filled
 * entirely with newlines, quotes, backslashes or tabs measures 99,994 — so a result
 * that honoured the budget cannot reach this, whatever it contains. That is the
 * property wanted: the backstop fires when a server did not bound itself, never
 * because it encoded something it did bound.
 *
 * ## Why only the servers this repository writes
 *
 * A third-party server gets no `max_output_chars` and keeps atoma's default. Raising
 * the bound for a server nobody here measured would widen the one cap that exists
 * precisely because nothing else covers it — measured in atoma, one third-party
 * `read_text_file` returning 72,141 characters against a `shell` that capped itself.
 */
export const TOOL_OUTPUT_BACKSTOP = TOOL_OUTPUT_BUDGET * 2;

/** Which end of an over-long result is worth keeping. */
export type Keep =
  /** A listing, a document, a diff: the beginning is the subject. */
  | "head"
  /** A log: the beginning is setup and the end is the failure. */
  | "tail"
  /** Command output, which is both — a header worth seeing and an error at the end. */
  | "both";

export interface CappedText {
  /**
   * The kept text, with the marker.
   *
   * The budget applies to the CONTENT; the marker is about fifty characters on
   * top of it. Reserving space for the marker would need its own length before it
   * can be written, and the number it reports depends on where the cut lands --
   * a fixed point solved for fifty characters nobody is counting.
   */
  text: string;
  /** Characters removed. Zero when nothing was. */
  dropped: number;
}

/**
 * Cut `text` to `budget`, keeping the part `keep` names and saying so in place.
 *
 * The marker is inside the returned text rather than only in a sibling field,
 * because the sibling field is what a caller forgets to read. A truncated result
 * that looks complete is how an agent concludes something is absent when it was
 * merely not shown — the failure `github__get_issue_comments`' `showing` header
 * exists to prevent, generalised.
 *
 * `keep: "tail"` is not a preference. `shell_execute` kept the HEAD of a
 * million-byte output, so a build log that overran lost the compiler error and
 * kept the banner. The end of a log is the part that was worth returning.
 */
export function capText(text: string, budget: number = TOOL_OUTPUT_BUDGET, keep: Keep = "head"): CappedText {
  if (text.length <= budget) return { text, dropped: 0 };

  const note = (where: string, howMany: number) => `\n\n[${howMany} characters ${where}; ${budget} shown]\n\n`;

  // The note is inside the budget, not on top of it, and this is the whole of why
  // the arithmetic below looks roundabout.
  //
  // It used to be `slice(0, budget) + note`, so the result came back LONGER than
  // the budget it was capping to. Harmless for a tool result, which is capped once
  // on its way into the session — and not harmless for a session, which
  // `domain/work/session-size.ts` caps again on every save. Each save saw a string
  // over the limit, cut another note's worth off it, and wrote a note claiming a
  // number that had been true one save ago. Measured across the stored sessions:
  // 157 of 601 had lost text that way, and the note is what an agent reads to
  // decide whether to fetch the result again.
  //
  // `text.length` is the largest `dropped` can ever be, so a note built from it is
  // the longest one possible. Reserving that much always leaves room for the real
  // one, and capping an already-capped string is then a no-op.
  const room = budget - note("dropped from the middle", text.length).length;
  const dropped = text.length - room;

  // A budget too small to hold the note at all. The length is the caller's hard
  // constraint — it is what keeps a request under a window — so the note is what
  // gives way, not the bound. Never reached by the budgets in this repository: the
  // smallest is 4,000 against a note of about fifty.
  if (room <= 0) return { text: keep === "tail" ? text.slice(-budget) : text.slice(0, budget), dropped: text.length - budget };

  if (keep === "tail") {
    return { text: note("dropped from the start", dropped).trimStart() + text.slice(-room), dropped };
  }
  if (keep === "head") {
    return { text: text.slice(0, room) + note("dropped from the end", dropped).trimEnd(), dropped };
  }

  // Both ends. A quarter at the front is enough for a command echo, a header, or
  // the first failing test; the rest goes to the end, where a build error is.
  const head = Math.floor(room / 4);
  const tail = room - head;
  return { text: text.slice(0, head) + note("dropped from the middle", dropped) + text.slice(-tail), dropped };
}

/**
 * Take items from the front of a list while the rendered whole still fits.
 *
 * For a list, `capText` is the wrong tool and quietly produces a broken answer:
 * cutting a JSON array mid-string leaves text that no longer parses, so the caller
 * gets neither the data nor a usable error. Whole items have to go instead, and
 * the count that went has to be reported — an omission nobody is told about is
 * read as an absence.
 *
 * Per-item capping happens before this, at the call site, because what "too long"
 * means depends on the field: a review body is prose and a diff hunk is code.
 */
export function fitItems<T>(items: readonly T[], budget: number = TOOL_OUTPUT_BUDGET): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const length = JSON.stringify(item).length + 1; // +1 for the separating comma
    if (used + length > budget && kept.length > 0) break;
    kept.push(item);
    used += length;
  }
  return { kept, omitted: items.length - kept.length };
}

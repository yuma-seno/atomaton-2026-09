/**
 * The one spelling of the token line an agent's comment carries.
 *
 * `post_result_comment` writes it at the end of a run; the metrics report reads it
 * back out of the GitHub API, in another process and often days later. That is one
 * fact in two places, and the failure is silent in the direction that matters: a
 * comma added on the writing side and not the reading side does not raise anything,
 * it just stops every token figure from being counted, and the report goes on
 * printing a smaller number with no sign that it shrank.
 *
 * So both sides come from here, and the round trip is tested rather than the regex.
 */

/** What a run measured, as the writer has it — strings, since it read them out of a log. */
export interface TokenLine {
  total?: string;
  prompt?: string;
  completion?: string;
  /**
   * How much of the prompt the provider served from its cache.
   *
   * Absent when it did not say, which is NOT zero: Atoma prints `cached=unknown` for
   * a run where no inference reported one, and the clause is then left out entirely.
   * Zero is a claim that the cache did nothing — the one reading an absent
   * measurement must not support, since a cache switched off looks exactly like it.
   */
  cached?: string;
}

/** What a reader gets back — numbers, with the same meaning for an absent cache. */
export interface ParsedTokenLine {
  total: number;
  prompt: number;
  completion: number;
  cached?: number;
}

const PATTERN =
  /_Tokens:\s*([\d,]+)\s*total\s*\(([\d,]+)\s*prompt\s*\+\s*([\d,]+)\s*completion(?:,\s*([\d,]+)\s*of the prompt cached)?\)_/;

/**
 * The line, from whatever the log gave up.
 *
 * A figure the log did not carry prints as `?` rather than as a number, and a line
 * with a `?` in it does not parse — which is correct: a reader counting it as zero
 * would be inventing a measurement that was never taken.
 */
export function renderTokenLine(u: TokenLine): string {
  const split = `${u.prompt ?? "?"} prompt + ${u.completion ?? "?"} completion`;
  const share = u.cached === undefined ? "" : `, ${u.cached} of the prompt cached`;
  return `_Tokens: ${u.total ?? "?"} total (${split}${share})_`;
}

/**
 * The figures in a comment body, or `undefined` if it carries no token line.
 *
 * The cached clause is optional on the way in: every comment posted before the
 * figure existed lacks it, and so does every run against a provider that reports no
 * cache. Both are "we do not know", which is what `undefined` says here.
 */
export function parseTokenLine(body: string): ParsedTokenLine | undefined {
  const match = PATTERN.exec(body);
  if (!match) return undefined;
  const toNumber = (s: string) => Number(s.replace(/,/g, ""));
  return {
    total: toNumber(match[1]!),
    prompt: toNumber(match[2]!),
    completion: toNumber(match[3]!),
    cached: match[4] === undefined ? undefined : toNumber(match[4]),
  };
}

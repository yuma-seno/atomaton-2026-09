import { describe, expect, test } from "bun:test";
import { parseTokenLine, renderTokenLine } from "./token-line.ts";

/**
 * The round trip, not the regex. The two halves of this format live in two processes
 * — a comment written at the end of a run, read back by the metrics report days later
 * — and a mismatch between them is silent: an unmatched line is simply not counted,
 * and the report keeps printing a smaller total with nothing to say it shrank.
 */
describe("the token line", () => {
  test("what the writer writes is what the reader reads", () => {
    const line = renderTokenLine({ total: "1050", prompt: "1000", completion: "50", cached: "800" });
    expect(parseTokenLine(line)).toEqual({ total: 1050, prompt: 1000, completion: 50, cached: 800 });
  });

  /**
   * The distinction the whole field exists to keep. A provider that says nothing about
   * its cache must not come back as a cache that served nothing: one is a gap in the
   * measurement and the other is a fault worth acting on.
   */
  test("a run whose provider said nothing about its cache reads as unknown, not as zero", () => {
    const line = renderTokenLine({ total: "1050", prompt: "1000", completion: "50" });
    expect(line).not.toContain("cached");
    expect(parseTokenLine(line)?.cached).toBeUndefined();
  });

  test("a cache that really served nothing is reported as nothing", () => {
    const line = renderTokenLine({ total: "1050", prompt: "1000", completion: "50", cached: "0" });
    expect(parseTokenLine(line)?.cached).toBe(0);
  });

  /** Every comment posted before the cache figure existed still counts. */
  test("a comment from before the field parses unchanged", () => {
    expect(parseTokenLine("_Tokens: 4,000 total (3,900 prompt + 100 completion)_")).toEqual({
      total: 4000,
      prompt: 3900,
      completion: 100,
      cached: undefined,
    });
  });

  /**
   * A figure the log did not carry prints as `?`, and such a line must not parse:
   * counted as zero it would be a measurement nobody took.
   */
  test("a line with a missing figure is not read as a zero", () => {
    expect(parseTokenLine(renderTokenLine({ total: "1050", completion: "50" }))).toBeUndefined();
  });

  test("a comment with no token line at all is not a token line", () => {
    expect(parseTokenLine("Looks good to me.")).toBeUndefined();
  });
});

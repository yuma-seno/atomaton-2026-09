/**
 * tool-output.test.ts — the cap, and which end of an over-long result survives.
 *
 * The direction of the cut is the part worth pinning. `shell_execute` kept the
 * head of a million-byte output, so a build log that overran returned its banner
 * and dropped the compiler error.
 */
import { describe, expect, test } from "bun:test";
import { capText, fitItems, TOOL_OUTPUT_BUDGET } from "./tool-output.ts";

const long = (n: number, char = "x") => char.repeat(n);

/** The marker and the blank lines around it, so a test can measure the content alone. */
const markerLength = (text: string) => (/\n*\[[^\]]*\]\n*/.exec(text)?.[0] ?? "").length;

describe("capText", () => {
  test("text within the budget is returned untouched", () => {
    const text = "a short result";
    const capped = capText(text);
    expect(capped.text).toBe(text);
    expect(capped.dropped).toBe(0);
  });

  test("text exactly at the budget is not marked", () => {
    const capped = capText(long(TOOL_OUTPUT_BUDGET));
    expect(capped.dropped).toBe(0);
    expect(capped.text).not.toContain("dropped");
  });

  test("the cut is announced in the text, not only in a field", () => {
    const capped = capText(long(1_000), 200);
    expect(capped.text).toContain(`${capped.dropped} characters`);
    expect(capped.text).toContain("200 shown");
  });

  describe("which end survives", () => {
    // `START…END`, so each case can be read off the result.
    const text = `START${long(400)}END`;

    test("head keeps the beginning — a diff, a listing, a document", () => {
      const capped = capText(text, 200, "head");
      expect(capped.text.startsWith("START")).toBe(true);
      expect(capped.text).not.toContain("END");
    });

    // The one that was wrong in production.
    test("tail keeps the end — a log's failure is at the bottom", () => {
      const capped = capText(text, 200, "tail");
      expect(capped.text.endsWith("END")).toBe(true);
      expect(capped.text).not.toContain("START");
    });

    test("both keeps each end — a command echo and the error after it", () => {
      const capped = capText(text, 200, "both");
      expect(capped.text.startsWith("START")).toBe(true);
      expect(capped.text.endsWith("END")).toBe(true);
      expect(capped.text).toContain("dropped from the middle");
    });
  });

  /**
   * The budget bounds the WHOLE result, marker included.
   *
   * It used to bound the content and let the marker sit on top, so the answer came
   * back longer than the number it was capping to. Nothing came of that for a tool
   * result, which is capped once on its way into the session. A session is capped
   * again on every save, and there each save saw a string over the limit, cut
   * another marker's worth off it, and wrote a number that had been true one save
   * ago — 157 of 601 stored sessions had lost text that way.
   */
  test("the whole result fits the budget, marker included", () => {
    for (const keep of ["head", "tail", "both"] as const) {
      const capped = capText(long(10_000), 500, keep);
      expect(capped.text.length, keep).toBeLessThanOrEqual(500);
    }
  });

  /** The property that makes it safe to cap the same text twice. */
  test("capping an already-capped result changes nothing", () => {
    for (const keep of ["head", "tail", "both"] as const) {
      const once = capText(long(10_000), 500, keep);
      const twice = capText(once.text, 500, keep);
      expect(twice.text, keep).toBe(once.text);
      expect(twice.dropped, keep).toBe(0);
    }
  });

  /** And the number in the marker is the number actually dropped. */
  test("the marker counts what went, not what would have gone", () => {
    const capped = capText(long(10_000), 500, "both");
    expect(capped.text).toContain(`${capped.dropped} characters`);
    expect(capped.dropped).toBe(10_000 - (capped.text.length - markerLength(capped.text)));
  });

  test("the budget is one number, shared", () => {
    // Named rather than asserted at a value: the point is that one module owns it.
    // 50,000 is ~12.5k tokens, a tenth of the smallest window worth designing for.
    expect(TOOL_OUTPUT_BUDGET).toBe(50_000);
  });
});

/**
 * A list needs whole items dropped, not a slice of its rendering.
 *
 * `capText` on a JSON array is the quiet wrong answer: cutting mid-string leaves
 * text that no longer parses, so the caller gets neither the data nor an error it
 * can act on.
 */
describe("fitItems", () => {
  test("returns everything when everything fits", () => {
    const { kept, omitted } = fitItems([{ a: 1 }, { a: 2 }]);
    expect(kept).toHaveLength(2);
    expect(omitted).toBe(0);
  });

  test("drops whole items and reports how many", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ i, body: "x".repeat(5000) }));
    const { kept, omitted } = fitItems(items);
    expect(kept.length).toBeLessThan(20);
    expect(kept.length + omitted).toBe(20);
  });

  // One item larger than the whole budget still comes back. Returning nothing
  // would be indistinguishable from "there are none", which is the failure this
  // module exists to prevent.
  test("a single oversized item is returned rather than nothing", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ i, body: "y".repeat(60_000) }));
    const { kept, omitted } = fitItems(items);
    expect(kept).toHaveLength(1);
    expect(omitted).toBe(4);
    expect(() => JSON.parse(JSON.stringify(kept))).not.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { leftClosingReport } from "./closing-report.ts";
import type { Session, SessionMessage } from "../work/session.ts";

/**
 * A session as the core leaves it, messages only: what the run actually said.
 *
 * Built and then round-tripped through JSON, because that is how both readers get one
 * -- off a file, not out of a constructor -- and a shape that only works when it was
 * typed in this file is not the shape being tested.
 */
const sessionOf = (...messages: Record<string, unknown>[]): Session =>
  JSON.parse(JSON.stringify({ messages, atoma_runs: [] })) as Session;

describe("leftClosingReport", () => {
  test("a closing message with words in it is a report", () => {
    expect(leftClosingReport(sessionOf({ role: "user", content: "do it" }, { role: "assistant", content: "Done: ..." }))).toBe(
      true,
    );
  });

  /**
   * The measured shape, and the whole reason this exists. 313, 173 and 110 tool calls,
   * a last turn that is another tool call, nothing said -- and the core recorded all
   * three as `completed`, so the ending was `finished` and the metrics report counted
   * them as work delivered.
   */
  test("a last turn of tool calls and no words is not", () => {
    expect(
      leftClosingReport(
        sessionOf(
          { role: "assistant", content: "" },
          { role: "tool", content: "ok" },
          { role: "assistant", content: "", tool_calls: [{ function: { name: "shell__shell_execute" } }] },
          { role: "tool", content: "ok" },
        ),
      ),
    ).toBe(false);
  });

  /**
   * The LAST assistant message, not any of them. These agents write prose exactly
   * once, in their final turn, so a sentence from earlier is from the middle of the
   * work -- and `post_result_comment.ts` labels one as such rather than showing it as
   * a conclusion. Counting it here would call a silent run reported.
   */
  test("something said in the middle of the work is not a report", () => {
    expect(
      leftClosingReport(
        sessionOf(
          { role: "assistant", content: "Right, the failure is in the parser." },
          { role: "tool", content: "ok" },
          { role: "assistant", content: "", tool_calls: [{ function: { name: "filesystem__read_text_file" } }] },
        ),
      ),
    ).toBe(false);
  });

  /** A picture travels as blocks; only the words in it are a report. */
  test("reads the block form, and a picture alone is not words", () => {
    const withText = sessionOf({ role: "assistant", content: [{ type: "text", text: "Here is what I found." }] });
    const pictureOnly = sessionOf({ role: "assistant", content: [{ type: "image", data: "...", mimeType: "image/png" }] });
    expect(leftClosingReport(withText)).toBe(true);
    expect(leftClosingReport(pictureOnly)).toBe(false);
  });

  test("whitespace is not words", () => {
    expect(leftClosingReport(sessionOf({ role: "assistant", content: "  \n " }))).toBe(false);
  });

  /** No session is no report: a run that wrote nothing reported nothing. */
  test("an absent or wordless session reported nothing", () => {
    expect(leftClosingReport(undefined)).toBe(false);
    expect(leftClosingReport({} as Session)).toBe(false);
    expect(leftClosingReport(sessionOf({ role: "user", content: "do it" }))).toBe(false);
  });

  /**
   * The stored history, which is the point of reading rather than recording: no field
   * was added for this, so it answers for sessions written long before anybody asked.
   * A session from before atoma recorded its runs still holds every message.
   */
  test("it answers for a session that predates the question", () => {
    const old: Session = {
      messages: [
        { role: "user", content: "have a look" },
        { role: "assistant", content: "Looked. The cache key is wrong." },
      ] as SessionMessage[],
    };
    expect(leftClosingReport(old)).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import type { Session, SessionMessage } from "../work/session.ts";
import { looksFailed, looksRefused, problemsIn, toolTroubleLine } from "./tool-trouble.ts";

/** A tool result, as the session stores one. */
function result(content: string): SessionMessage {
  return { role: "tool", tool_call_id: "c1", content };
}

/** The block a server appends to an answer it gave badly. */
function reported(server: string, ...lines: string[]): string {
  return [
    "3 results",
    "",
    `--- ${lines.length} problem${lines.length === 1 ? "" : "s"} reported by the '${server}' server, not part of the answer above ---`,
    ...lines,
  ].join("\n");
}

function session(...messages: SessionMessage[]): Session {
  return { messages };
}

describe("what the tools did to a run", () => {
  /**
   * The case this exists for. Measured over 396 sessions: 30 runs carried one of
   * these and 3 said so — and the one that went unsaid for weeks was a reranker
   * that would not load, which put every search into first-stage order.
   */
  test("counts a problem a server reported about itself, and names the server", () => {
    const line = toolTroubleLine(
      session(result(reported("search", "warning: could not preload the reranker (EACCES)"))),
      0,
    );
    expect(line).toContain("1 problem a server reported about itself");
    expect(line).toContain("`search`");
  });

  test("several servers are named, and the sentence stops claiming there was one", () => {
    const line = toolTroubleLine(
      session(
        result(reported("search", "warning: reranker did not load")),
        result(reported("audit", "error: the op log went to a path that does not exist")),
      ),
      0,
    );
    expect(line).toContain("2 problems servers reported about themselves");
    expect(line).toContain("`audit`");
    expect(line).toContain("`search`");
  });

  /**
   * A guard refusing the agent and a tool breaking under it are one number here,
   * although the metrics report separates them. The question differs: there it is
   * whether the tool is broken, here it is whether this run hit something its report
   * should have carried, and a refusal is equally that.
   */
  test("a refused call and an errored one are both counted", () => {
    const line = toolTroubleLine(
      session(
        result("Error: command blocked by hook shell_guard: reading /proc is disabled"),
        result("Error: ENOENT: no such file or directory"),
      ),
      0,
    );
    expect(line).toContain("2 refused or errored tool calls");
    expect(line).not.toContain("problem");
  });

  test("one of either reads as one", () => {
    expect(toolTroubleLine(session(result("Error: ENOENT")), 0)).toContain("1 refused or errored tool call.");
  });

  /**
   * The ordinary run. The comment goes out either way, so this is an addition to it
   * and never a precondition for it.
   */
  test("says nothing when the tools gave the run no trouble", () => {
    expect(toolTroubleLine(session(result("ok"), { role: "assistant", content: "Done." }), 0)).toBeUndefined();
    expect(toolTroubleLine(undefined, 0)).toBeUndefined();
    expect(toolTroubleLine({}, 0)).toBeUndefined();
  });

  /**
   * A session accumulates across runs. Counting from the top would put an earlier
   * run's trouble under this run's comment, which is the defect `lastAgentText` was
   * given the same boundary for — and harder to see here, because a wrong count still
   * looks exactly like a count.
   */
  test("an earlier run's trouble is not this run's", () => {
    const messages = [
      result(reported("search", "warning: reranker did not load")),
      result("Error: ENOENT"),
      { role: "user", content: "/engineer carry on" } as SessionMessage,
      result("ok"),
    ];
    expect(toolTroubleLine(session(...messages), 3)).toBeUndefined();
    expect(toolTroubleLine(session(...messages), 0)).toContain("1 problem");
  });

  test("no boundary, no count: a number that may be somebody else's is worse than none", () => {
    const one = session(result("Error: ENOENT"));
    expect(toolTroubleLine(one, undefined)).toBeUndefined();
    expect(toolTroubleLine(one, Number("not a number"))).toBeUndefined();
  });

  /**
   * The words come out of the block, not out of the answer. A grep for "error:"
   * returns lines beginning "error:", and counting those would fill this with
   * whatever the agents happened to be reading.
   */
  test("a result that merely quotes a warning is not a server reporting one", () => {
    const quoted = result("warning: this is a line of the file the agent read\nerror: and so is this");
    expect(problemsIn(quoted.content as string)).toEqual([]);
  });

  test("a guard saying no is not a tool breaking", () => {
    const refusal = "Error: `rm -rf /` is blocked by denylist pattern";
    expect(looksRefused(refusal)).toBe(true);
    expect(looksFailed(refusal)).toBe(false);
    expect(looksFailed("Error: ENOENT")).toBe(true);
  });
});

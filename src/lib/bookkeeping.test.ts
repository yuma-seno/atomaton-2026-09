import { describe, expect, test } from "bun:test";
import { PARENT_TAG } from "./tags.ts";
import { withoutBookkeeping, type McpDispatch } from "./mcp-tool.ts";

/**
 * Which results get edited, and which are shown as they came back.
 *
 * The distinction is not cosmetic. GitHub's prose carries Atomaton's own markers and an
 * agent should not read them as part of an answer. A diff or a code excerpt is the text
 * under review, where the same characters are the change — and the first version of
 * this wrapped a whole server, so a pull request touching a file that holds a literal
 * tag came back as a diff that was not the diff.
 */
describe("withoutBookkeeping", () => {
  const body = `${PARENT_TAG.write(42)}\nSome prose.`;
  const echo: McpDispatch = async (name) => ({ text: name === "get_pr_diff" ? `+  ${body}` : body });

  test("a named tool's result loses the markers", async () => {
    const dispatch = withoutBookkeeping(echo, ["get_pr"]);
    expect((await dispatch("get_pr", {})).text).toBe("Some prose.");
  });

  /**
   * The case this was corrected for. A tag-shaped literal inside a diff is a line of
   * the change, and a reviewer given it edited is reviewing something that does not
   * exist.
   */
  test("a diff is shown as it came back, tag-shaped lines included", async () => {
    const dispatch = withoutBookkeeping(echo, ["get_pr"]);
    const diff = (await dispatch("get_pr_diff", {})).text;
    expect(diff).toContain("atomaton:parent=42");
  });

  /**
   * The safer default of the two. A tool left off the list keeps its markers, which is
   * what every result did before any of this and which nothing broke; a tool wrongly on
   * it has its content edited under a reader who cannot tell.
   */
  test("a tool nobody named keeps what it returned", async () => {
    const dispatch = withoutBookkeeping(echo, []);
    expect((await dispatch("get_pr", {})).text).toContain("atomaton:parent=42");
  });

  test("everything else about the result is passed through", async () => {
    const withMeta: McpDispatch = async () => ({ text: body, meta: { session_ends: true } });
    const dispatch = withoutBookkeeping(withMeta, ["get_pr"]);
    expect((await dispatch("get_pr", {})).meta).toEqual({ session_ends: true });
  });
});

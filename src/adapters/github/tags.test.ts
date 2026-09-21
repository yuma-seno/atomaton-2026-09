import { describe, expect, test } from "bun:test";
import { AGGREGATED_TAG, AGENT_TAG, CHANGED_TAG, LLM_CONTEXT_TAG, NOTIFY_TAG, PARENT_ISSUE_TAG, withoutTags } from "./tags.ts";

/**
 * These markers carry state between workflow runs through GitHub, so they live in the
 * very text that becomes an agent's context — issue bodies, pull request bodies,
 * comments. Nothing removed them on the way in, and a real session carried
 * `agent=orchestrator`, `changed=yes`, `notify=hws-yuma-seno`, `origin-agent=engineer`
 * and `parent-issue=766` into the prompt.
 */
describe("withoutTags", () => {
  test("a result comment arrives without its bookkeeping", () => {
    const body = [AGENT_TAG.write("engineer"), CHANGED_TAG.write("yes"), "Done. Opened PR #12."].join("\n");
    expect(withoutTags(body)).toBe("Done. Opened PR #12.");
  });

  test("a tag in the middle of a body goes too", () => {
    // One space, not two: removing a tag reads as removing a word, not as leaving
    // the gap where one used to be.
    expect(withoutTags(`before ${PARENT_ISSUE_TAG.write(4)} after`)).toBe("before after");
  });

  /**
   * The machinery writes its comments through `gh --body` and gets \n, but a body a
   * person edited in the browser comes back with \r\n -- and those are the bodies
   * `parent`, `notify` and `origin-agent` live in. Matching only \n left a stray
   * carriage return and a blank line at the top of exactly the text a person had
   * touched.
   */
  test("a body a person edited in the browser is left as clean as one we wrote", () => {
    const crlf = [PARENT_ISSUE_TAG.write(4), "Body text."].join("\r\n");
    expect(withoutTags(crlf)).toBe("Body text.");
  });

  /**
   * Run to run, the same body has to strip to the same bytes: a prompt cache is a
   * prefix match, so a single character that moves costs everything after it.
   */
  test("stripping twice is stripping once", () => {
    const body = [AGENT_TAG.write("engineer"), CHANGED_TAG.write("yes"), "Done."].join("\r\n");
    const once = withoutTags(body);
    expect(withoutTags(once)).toBe(once);
  });

  /**
   * The one that gives the shape away: a marker saying "do not show this to the model"
   * was being shown to the model.
   */
  test("the marker for what must not reach the model does not reach the model", () => {
    const body = `${LLM_CONTEXT_TAG.write("exclude")}\nAtomaton: PR #12 created.`;
    expect(withoutTags(body)).not.toContain("llm-context");
  });

  test("who to mention is machinery, not conversation", () => {
    expect(withoutTags(NOTIFY_TAG.write("hws-yuma-seno"))).toBe("");
  });

  /**
   * Prose about the tags survives. An issue explaining the wire format writes a
   * placeholder, not a value, so it does not match — which is what keeps this from
   * quietly editing a conversation about itself.
   */
  test("an issue explaining the format keeps its explanation", () => {
    const body = "A sub-issue carries `<!-- atomaton:parent=N -->` in its body.";
    expect(withoutTags(body)).toBe(body);
  });

  /**
   * The other way the same text reaches an agent: a tool server hands a pull request
   * body back inside a JSON document, where the newline after a tag is the two
   * characters \ and n rather than a real line ending. Matching only a real one left
   * those behind as escapes, so the body read as starting with blank lines.
   */
  test("a body handed back inside JSON is stripped as cleanly as a raw one", () => {
    const body = [PARENT_ISSUE_TAG.write(788), "Closes #788."].join("\n");
    const payload = JSON.stringify({ number: 802, state: "OPEN", body });
    expect(withoutTags(payload)).toBe(JSON.stringify({ number: 802, state: "OPEN", body: "Closes #788." }));
  });

  test("text with no tag in it is returned as it was", () => {
    expect(withoutTags("Just a comment.")).toBe("Just a comment.");
  });

  /**
   * Every tag, from the list the tags themselves register. A tag added later is
   * stripped from the moment it exists; a hand-written list would be the same fact in
   * two places, and the half that falls behind is the half that leaks.
   */
  test("a tag defined after this test was written is stripped too", () => {
    const everyTag = [
      AGENT_TAG.write("reviewer"),
      CHANGED_TAG.write("no"),
      PARENT_ISSUE_TAG.write(9),
      NOTIFY_TAG.write("someone"),
      LLM_CONTEXT_TAG.write("include"),
    ].join("\n");
    expect(withoutTags(everyTag)).toBe("");
  });
});

/**
 * The form GitHub search can actually match.
 *
 * Measured the hard way: a work-tree walk searched for `write()`'s output and found
 * none of its children, on a repository where every one of them carried the tag.
 * GitHub does not match `<!-- ... -->`, so the search form is the tag text alone —
 * and it lives here rather than being typed out at each call site, which is where the
 * literal `atomaton:parent=` had reached four files.
 */
describe("search", () => {
  test("is the tag text without the comment wrapper", () => {
    expect(PARENT_ISSUE_TAG.search(803)).toBe("atomaton:parent-issue=803");
  });

  test("and is therefore not what write produces", () => {
    expect(PARENT_ISSUE_TAG.search(803)).not.toBe(PARENT_ISSUE_TAG.write(803));
    expect(PARENT_ISSUE_TAG.search(803)).not.toContain("<!--");
  });

  /**
   * Two tags must not search as one another: a query for one that is a prefix of
   * another's returns both, and the caller cannot tell. This pair used to be
   * `atomaton:parent` and `atomaton:parent-issue`, where the first IS a prefix of the
   * second up to the `=` — the reason `search` puts the value straight after the name.
   */
  test("two tags do not search as one another", () => {
    expect(AGGREGATED_TAG.search(803)).not.toBe(PARENT_ISSUE_TAG.search(803));
    expect(PARENT_ISSUE_TAG.search(803)).not.toContain(AGGREGATED_TAG.search(803));
  });
});

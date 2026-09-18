import { describe, expect, test } from "bun:test";
import { AGENT_TAG, CHANGED_TAG, LLM_CONTEXT_TAG, NOTIFY_TAG, PARENT_TAG, withoutTags } from "./tags.ts";

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
    expect(withoutTags(`before ${PARENT_TAG.write(4)} after`)).toBe("before  after");
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
      PARENT_TAG.write(9),
      NOTIFY_TAG.write("someone"),
      LLM_CONTEXT_TAG.write("include"),
    ].join("\n");
    expect(withoutTags(everyTag)).toBe("");
  });
});

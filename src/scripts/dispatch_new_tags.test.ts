import { describe, expect, test } from "bun:test";
import { parseBefore, TAGS_BEFORE_VAR } from "./dispatch_new_tags.ts";
import { runWithFakeGh, scriptPath } from "./testing/harness.ts";

/**
 * The endpoint's shape, as `readTags` asks for it: the ref and the commit it names.
 * The sha is what a containment check needs, so it travels with every tag.
 */
const refs = (...tags: string[]) => tags.map((tag) => `refs/tags/${tag} sha-${tag}`).join("\n");

function dispatch(before: string, tagsNow: string | { code: number }) {
  const listing =
    typeof tagsNow === "string"
      ? { match: ["api", "matching-refs/tags"], stdout: tagsNow }
      : { match: ["api", "matching-refs/tags"], code: tagsNow.code, stdout: "" };
  return runWithFakeGh(scriptPath("dispatch_new_tags.ts"), ["--repo", "o/r"], {
    rules: [listing, { match: ["workflow", "run"], stdout: "" }],
    env: { [TAGS_BEFORE_VAR]: before },
  });
}

const dispatched = (calls: string[][]) =>
  calls.filter((call) => call[0] === "workflow").map((call) => call[call.indexOf("--ref") + 1]);

/**
 * The fifth instance of the hole `dispatch-targets.ts` names four of: GitHub starts
 * no workflow run for events its own token triggers. A deployment that cuts a
 * release tags with GITHUB_TOKEN, so `on_tag` never fired for it.
 */
describe("dispatch_new_tags.ts", () => {
  test("a tag the deployment created starts a deploy run for that tag", () => {
    const r = dispatch(JSON.stringify(["v1.0.0"]), refs("v1.0.0", "v1.1.0"));
    expect(r.status).toBe(0);
    expect(dispatched(r.ghCalls)).toEqual(["v1.1.0"]);
    const run = r.ghCalls.find((call) => call[0] === "workflow") ?? [];
    expect(run).toContain("atomaton-deploy.yml");
    expect(run).toContain("trigger=tag");
  });

  test("several are dispatched, one run each", () => {
    const r = dispatch("[]", refs("v1.0.0", "v1.1.0"));
    expect(r.status).toBe(0);
    expect(dispatched(r.ghCalls)).toEqual(["v1.0.0", "v1.1.0"]);
  });

  /** The ordinary case: most deployments tag nothing, and must say nothing. */
  test("a deployment that tagged nothing dispatches nothing", () => {
    const r = dispatch(JSON.stringify(["v1.0.0"]), refs("v1.0.0"));
    expect(r.status).toBe(0);
    expect(dispatched(r.ghCalls)).toEqual([]);
    expect(r.stderr).toContain("created no tags");
  });

  test("a repository with no tags at all is not a repository that just made none", () => {
    const r = dispatch("[]", "");
    expect(r.status).toBe(0);
    expect(dispatched(r.ghCalls)).toEqual([]);
  });

  /**
   * A dispatch that does not happen is a production deployment that does not
   * happen, and nothing else would notice. So both halves fail loudly.
   */
  describe("what it refuses to do quietly", () => {
    test("a tag list that could not be read fails", () => {
      const r = dispatch("[]", { code: 1 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("tags could not be read");
      expect(dispatched(r.ghCalls)).toEqual([]);
    });

    test("a refused dispatch fails, after trying every tag", () => {
      const r = runWithFakeGh(scriptPath("dispatch_new_tags.ts"), ["--repo", "o/r"], {
        rules: [
          { match: ["api", "matching-refs/tags"], stdout: refs("v1.0.0", "v1.1.0") },
          { match: ["workflow", "run"], code: 1, stdout: "refused" },
        ],
        env: { [TAGS_BEFORE_VAR]: "[]" },
      });
      expect(r.status).toBe(1);
      expect(dispatched(r.ghCalls)).toEqual(["v1.0.0", "v1.1.0"]);
      expect(r.stderr.match(/::error::/g)).toHaveLength(2);
    });

    test("a `before` that is not a list of tags fails rather than comparing against nothing", () => {
      const r = dispatch("not json", refs("v1.0.0"));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("JSON array");
    });
  });
});

describe("parseBefore", () => {
  test("an empty argument is an empty list, not a failure", () => {
    expect(parseBefore("")).toEqual([]);
  });

  test("a list of strings is the list", () => {
    expect(parseBefore('["v1.0.0","v2"]')).toEqual(["v1.0.0", "v2"]);
  });

  /** Null, not `[]`: comparing against nothing would report every tag as new. */
  test("anything else is null", () => {
    expect(parseBefore("{}")).toBeNull();
    expect(parseBefore("[1]")).toBeNull();
    expect(parseBefore("oops")).toBeNull();
  });
});

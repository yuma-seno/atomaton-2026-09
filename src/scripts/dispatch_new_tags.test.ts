import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { parseBefore, TAGS_BEFORE_VAR } from "./dispatch_new_tags.ts";
import { makeConfigDir, runWithFakeGh, scriptPath } from "./testing/harness.ts";

/**
 * The endpoint's shape, as `readTags` asks for it: the ref and the commit it names.
 * The sha is what a containment check needs, so it travels with every tag.
 */
const refs = (...tags: string[]) => tags.map((tag) => `refs/tags/${tag} sha-${tag}`).join("\n");

/**
 * Run with a config of the test's own, rather than in this repository's checkout.
 *
 * The dispatch reads `deploy.your_workflow` now — which is the fix, and which makes
 * the ambient `config.yaml` an input. A test that let the repository's own file
 * answer would pass here and say nothing about an adopter's.
 */
function dispatch(before: string, tagsNow: string | { code: number }, config: Record<string, unknown> = {}) {
  const listing =
    typeof tagsNow === "string"
      ? { match: ["api", "matching-refs/tags"], stdout: tagsNow }
      : { match: ["api", "matching-refs/tags"], code: tagsNow.code, stdout: "" };
  const dir = makeConfigDir(config);
  try {
    return runWithFakeGh(scriptPath("dispatch_new_tags.ts"), ["--repo", "o/r"], {
      cwd: dir,
      rules: [listing, { match: ["workflow", "run"], stdout: "" }],
      env: { [TAGS_BEFORE_VAR]: before },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  /**
   * The bug this script had while it built its own `gh workflow run`: it named
   * `atomaton-deploy.yml` outright and sent `trigger=tag` unconditionally, so a
   * project that had named its own deployment workflow would have had the wrong
   * workflow started with an input it does not declare. `dispatchCd` answered the
   * same question correctly two files away.
   */
  test("a project's own deployment workflow is the one started, and gets no `trigger`", () => {
    const r = dispatch("[]", refs("v1.0.0"), { deploy: { your_workflow: "cd.yml" } });
    expect(r.status).toBe(0);
    const run = r.ghCalls.find((call) => call[0] === "workflow") ?? [];
    expect(run).toContain("cd.yml");
    expect(run).not.toContain("atomaton-deploy.yml");
    expect(run.join(" "), "only the shipped workflow understands why it was started").not.toContain("trigger=");
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
      const dir = makeConfigDir({});
      const r = (() => {
        try {
          return runWithFakeGh(scriptPath("dispatch_new_tags.ts"), ["--repo", "o/r"], {
            cwd: dir,
            rules: [
              { match: ["api", "matching-refs/tags"], stdout: refs("v1.0.0", "v1.1.0") },
              { match: ["workflow", "run"], code: 1, stdout: "refused" },
            ],
            env: { [TAGS_BEFORE_VAR]: "[]" },
          });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      })();
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

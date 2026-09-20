import { describe, expect, test } from "bun:test";
import { runWithFakeGh, scriptPath } from "./testing/harness.ts";

describe("resolve_orchestrator_parent.ts", () => {
  test("resolves the parent via the GraphQL sub-issues API", () => {
    // gh api graphql wraps the real GraphQL response in a top-level "data"
    // envelope -- lib/gh.ts's ghGraphql() unwraps `.data`, so the fake gh's
    // canned stdout must match that shape too.
    const r = runWithFakeGh(scriptPath("resolve_orchestrator_parent.ts"), ["--repo", "owner/repo", "--sub", "9"], {
      rules: [{ match: ["graphql"], stdout: JSON.stringify({ data: { repository: { issue: { parent: { number: 3 } } } } }) }],
    });
    expect(r.stdout.trim()).toBe("3");
  });

  // A root issue: GitHub has it under nothing.
  test("prints nothing for an issue that has no parent", () => {
    const r = runWithFakeGh(scriptPath("resolve_orchestrator_parent.ts"), ["--repo", "owner/repo", "--sub", "9"], {
      rules: [{ match: ["graphql"], stdout: JSON.stringify({ data: { repository: { issue: { parent: null } } } }) }],
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  // The distinction the caller depends on. Empty stdout is how "no parent" is
  // spelled, so a failed read that also printed "" would be indistinguishable
  // from a root issue -- and the aggregation that should have followed would
  // simply never happen, with nothing anywhere saying why.
  //
  // It matters more since the `atomaton:parent` tag went: there is no second place
  // to look, so this query IS the answer. `ghGraphqlRead` retries a transient
  // failure, and only one that outlasts the retries gets here.
  test("fails rather than printing an empty parent it could not read", () => {
    const r = runWithFakeGh(scriptPath("resolve_orchestrator_parent.ts"), ["--repo", "owner/repo", "--sub", "9"], {
      rules: [{ match: ["graphql"], code: 1, stdout: "gh: not found" }],
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).toBe("");
    expect(r.stderr).toContain("could not read the parent of #9");
  });
});

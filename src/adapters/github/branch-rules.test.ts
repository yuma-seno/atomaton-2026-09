import { describe, expect, test } from "bun:test";
import { deploymentRefusal, type BranchRules } from "./branch-rules.ts";

const PROTECTED: BranchRules = { known: true, enforceable: true, contexts: [], pullRequestRequired: true };

/**
 * A deployment runs commands a project wrote, with the credentials it declared and
 * `contents: write` besides. Every refusal below is a run that would otherwise have
 * started from a commit nobody reviewed.
 */
describe("deploymentRefusal", () => {
  test("a branch requiring a pull request may deploy", () => {
    expect(deploymentRefusal("main", PROTECTED)).toBe("");
  });

  /**
   * The hole `branches:` opened. The shipped ruleset covers `~DEFAULT_BRANCH` and
   * nothing else, so writing `branches: [develop]` was enough to reach a deployment
   * by pushing straight to `develop` — with nothing anywhere saying so.
   */
  test("a branch nothing protects may not", () => {
    const refusal = deploymentRefusal("develop", { ...PROTECTED, pullRequestRequired: false });
    expect(refusal).toContain("'develop'");
    expect(refusal).toContain("not covered by a ruleset requiring a pull request");
  });

  /**
   * "Could not be read" is not "is protected". Reading the first as the second is
   * the defect this repository keeps finding: a check whose input is missing must
   * say so rather than pass.
   */
  test("rules that could not be read are refused, not assumed", () => {
    const refusal = deploymentRefusal("main", { known: false, why: "the branch rules for main could not be read" });
    expect(refusal).toContain("could not be read");
    expect(refusal).toContain("refused rather than assumed");
  });

  /**
   * A free private repository cannot have rulesets at all. `validate_pull_request`
   * treats that as a known answer and carries on, enforcing CI itself — but nothing
   * can enforce a review of a direct push, so a deployment has nothing to stand on.
   */
  test("a repository that cannot have rules at all is refused", () => {
    const refusal = deploymentRefusal("main", {
      known: true,
      enforceable: false,
      contexts: [],
      pullRequestRequired: false,
      why: "branch rules are not available on this repository",
    });
    expect(refusal).toContain("not available on this repository");
    expect(refusal).toContain("'main'");
  });

  /** Every refusal says what to do about it, not only that it happened. */
  test("each refusal names a way out", () => {
    const cases: BranchRules[] = [
      { ...PROTECTED, pullRequestRequired: false },
      { known: false, why: "unreadable" },
      { known: true, enforceable: false, contexts: [], pullRequestRequired: false, why: "unavailable" },
    ];
    for (const rules of cases) {
      expect(deploymentRefusal("develop", rules)).toMatch(/Deploy from|deploy the deployment|deploy from|or move|Add a ruleset/);
    }
  });
});

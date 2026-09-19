import { describe, expect, test } from "bun:test";
import { makeConfigDir, parseGithubOutput, removeTemp, runWithFakeGh, scriptPath } from "./testing/harness.ts";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEPLOY = {
  deploy: {
    on_merge: [
      { name: "release", commands: ["./release.sh"] },
      { name: "staging", branches: ["develop"], secrets: ["STAGING_TOKEN"], commands: ["./stage.sh"] },
    ],
    on_tag: [{ name: "production", tags: ["v*"], commands: ["./prod.sh"] }],
    on_demand: [{ name: "rollback", commands: ["./rollback.sh"] }],
  },
};

/** The rules endpoint's answer for a branch a ruleset requires a pull request on. */
const PROTECTED = JSON.stringify([{ type: "pull_request" }, { type: "required_status_checks", parameters: { required_status_checks: [] } }]);
/** Measured: a branch nothing covers answers `[]`, and so does one that does not exist. */
const UNPROTECTED = "[]";

function plan(args: string[], rulesStdout: string | { code: number } = PROTECTED) {
  const dir = makeConfigDir(DEPLOY);
  const outDir = mkdtempSync(join(tmpdir(), "atomaton-plan-"));
  const outputPath = join(outDir, "github_output");
  writeFileSync(outputPath, "");
  try {
    const rule =
      typeof rulesStdout === "string"
        ? { match: ["api", "rules/branches"], stdout: rulesStdout }
        : { match: ["api", "rules/branches"], code: rulesStdout.code, stdout: "" };
    const r = runWithFakeGh(scriptPath("plan_deploy.ts"), ["--repo", "o/r", ...args], {
      rules: [rule, { match: ["api", "matching-refs/tags"], stdout: "refs/tags/v1.0.0" }],
      cwd: dir,
      env: { GITHUB_OUTPUT: outputPath },
    });
    return { ...r, outputs: parseGithubOutput(readFileSync(outputPath, "utf8")) };
  } finally {
    removeTemp(dir);
    removeTemp(outDir);
  }
}

const names = (jobs: string | undefined) =>
  (JSON.parse(jobs ?? "[]") as { name: string }[]).map((job) => job.name);

const PUSH_MAIN = ["--ref", "refs/heads/main", "--default-branch", "main", "--event", "push"];
const PUSH_DEVELOP = ["--ref", "refs/heads/develop", "--default-branch", "main", "--event", "push"];

describe("plan_deploy.ts", () => {
  test("a push to the default branch plans the entries naming no branches", () => {
    const r = plan(PUSH_MAIN);
    expect(r.status).toBe(0);
    expect(names(r.outputs.jobs)).toEqual(["release"]);
  });

  /** The whole matrix entry, because it is the contract with the generated workflow. */
  test("a push to a branch an entry names plans that one, with its own secrets", () => {
    const r = plan(PUSH_DEVELOP);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.outputs.jobs ?? "[]")).toEqual([
      { name: "staging", runs_on: '["ubuntu-latest"]', commands: ["./stage.sh"], secrets: ["STAGING_TOKEN"] },
    ]);
  });

  test("a pushed tag plans the entries whose patterns claim it", () => {
    const r = plan(["--ref", "refs/tags/v1.0.0", "--default-branch", "main", "--event", "push"]);
    expect(r.status).toBe(0);
    expect(names(r.outputs.jobs)).toEqual(["production"]);
  });

  /**
   * A repository tags and pushes for reasons that have nothing to do with deploying.
   * A red run for each one teaches people to ignore the red.
   */
  test("a push nothing claimed publishes an empty matrix and stays green", () => {
    const r = plan(["--ref", "refs/heads/feature-x", "--default-branch", "main", "--event", "push"]);
    expect(r.status).toBe(0);
    expect(names(r.outputs.jobs)).toEqual([]);
  });

  test("a bad declaration fails rather than reading as a project that deploys nothing", () => {
    const dir = makeConfigDir({ deploy: { on_tag: [{ name: "p", commands: ["x"] }] } });
    try {
      const r = runWithFakeGh(scriptPath("plan_deploy.ts"), ["--repo", "o/r", ...PUSH_MAIN], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("::error::");
      expect(r.stderr).toContain("tags");
    } finally {
      removeTemp(dir);
    }
  });

  test("a target that does not exist is an error, not an empty plan", () => {
    const r = plan(["--ref", "refs/heads/main", "--default-branch", "main", "--event", "workflow_dispatch", "--target", "nope"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No deployment named 'nope'");
  });

  /**
   * The hole `branches:` opened, closed here. Anyone who can push to an unprotected
   * branch would otherwise run that branch's deployment with its credentials.
   */
  describe("the branch has to be one a pull request is required on", () => {
    test("a branch nothing protects is refused", () => {
      const r = plan(PUSH_DEVELOP, UNPROTECTED);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("not covered by a ruleset requiring a pull request");
      expect(r.stderr).toContain("Refused to deploy: staging");
      expect(r.outputs.jobs).toBeUndefined();
    });

    test("rules that could not be read are refused too, not assumed to be there", () => {
      const r = plan(PUSH_DEVELOP, { code: 1 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("could not be read");
    });

    /**
     * Asked only when something would actually deploy: an ordinary push to an
     * unprotected feature branch selects nothing, and a refusal about a branch
     * nobody was deploying from is noise that teaches people to ignore it.
     */
    test("a push that deploys nothing does not ask, and does not refuse", () => {
      const r = plan(["--ref", "refs/heads/feature-x", "--default-branch", "main", "--event", "push"], UNPROTECTED);
      expect(r.status).toBe(0);
      expect(r.ghCalls).toEqual([]);
    });

    /**
     * A tag is not a branch and has none of these rules to read. Refusing every tag
     * deployment for the want of a branch rule would answer a question nobody asked.
     */
    test("a tag deployment is not judged by a branch's rules", () => {
      const r = plan(["--ref", "refs/tags/v1.0.0", "--default-branch", "main", "--event", "push"], UNPROTECTED);
      expect(r.status).toBe(0);
      expect(r.ghCalls).toEqual([]);
    });

    test("the branch it asks about is the one being deployed", () => {
      const r = plan(PUSH_DEVELOP);
      expect(r.ghCalls.map((call) => call.join(" "))).toContain("api repos/o/r/rules/branches/develop");
    });
  });

  /**
   * The snapshot the run compares against afterwards. A deployment that cuts a
   * release tags with GITHUB_TOKEN, so no `push` arrives and `on_tag` would never
   * fire for it — see `dispatch_new_tags.ts`.
   */
  describe("the tags that existed before", () => {
    test("a deployment on a project declaring `on_tag` takes one", () => {
      const r = plan(PUSH_MAIN);
      expect(JSON.parse(r.outputs.tags_before ?? "null")).toEqual(["v1.0.0"]);
    });

    /** Nothing to watch for, so nothing is published and the dispatch job is skipped. */
    test("a project with no tag deployment takes none", () => {
      const dir = makeConfigDir({ deploy: { on_merge: [{ name: "release", commands: ["./release.sh"] }] } });
      const outDir = mkdtempSync(join(tmpdir(), "atomaton-plan-"));
      const outputPath = join(outDir, "github_output");
      writeFileSync(outputPath, "");
      try {
        const r = runWithFakeGh(scriptPath("plan_deploy.ts"), ["--repo", "o/r", ...PUSH_MAIN], {
          rules: [{ match: ["api", "rules/branches"], stdout: PROTECTED }],
          cwd: dir,
          env: { GITHUB_OUTPUT: outputPath },
        });
        expect(r.status).toBe(0);
        expect(parseGithubOutput(readFileSync(outputPath, "utf8")).tags_before).toBeUndefined();
        expect(r.ghCalls.some((call) => call.join(" ").includes("matching-refs/tags"))).toBe(false);
      } finally {
        removeTemp(dir);
        removeTemp(outDir);
      }
    });

    /** A tag run is a leaf: a deployment that tags, started by a tag, would loop. */
    test("a run started by a tag takes none", () => {
      const r = plan(["--ref", "refs/tags/v1.0.0", "--default-branch", "main", "--event", "push"]);
      expect(r.status).toBe(0);
      expect(r.outputs.tags_before).toBeUndefined();
    });

    test("a push that deploys nothing takes none", () => {
      const r = plan(["--ref", "refs/heads/feature-x", "--default-branch", "main", "--event", "push"]);
      expect(r.outputs.tags_before).toBeUndefined();
    });

    /**
     * Refused rather than skipped. Publishing nothing would skip the dispatch job,
     * and a tag deployment going missing is exactly what nothing else would notice.
     */
    test("a tag list that could not be read fails the plan", () => {
      const dir = makeConfigDir(DEPLOY);
      try {
        const r = runWithFakeGh(scriptPath("plan_deploy.ts"), ["--repo", "o/r", ...PUSH_MAIN], {
          rules: [
            { match: ["api", "rules/branches"], stdout: PROTECTED },
            { match: ["api", "matching-refs/tags"], code: 1, stdout: "" },
          ],
          cwd: dir,
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("tags could not be read");
      } finally {
        removeTemp(dir);
      }
    });
  });
});

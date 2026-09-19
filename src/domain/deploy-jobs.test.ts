import { describe, expect, test } from "bun:test";
import {
  mergeMightDeploy,
  refMatches,
  refPatternProblem,
  resolveDeployJobs,
  selectDeployJobs,
  type DeployRequest,
} from "./deploy-jobs.ts";

const SHIP = { name: "ship", commands: ["./ship.sh"] };

function jobsOf(deploy: unknown) {
  const { jobs, problems } = resolveDeployJobs(deploy);
  expect(problems).toEqual([]);
  return jobs;
}

function request(over: Partial<DeployRequest>): DeployRequest {
  return { ref: "", defaultBranch: "main", event: "push", trigger: "", target: "", ...over };
}

describe("resolveDeployJobs", () => {
  test("an entry keeps its name, commands, secrets and the refs its list owns", () => {
    const jobs = jobsOf({ on_tag: [{ ...SHIP, tags: ["v*"], secrets: ["PROD_TOKEN"] }] });
    expect(jobs).toEqual([
      {
        name: "ship",
        runsOn: ["ubuntu-latest"],
        commands: ["./ship.sh"],
        secrets: ["PROD_TOKEN"],
        refs: ["v*"],
        trigger: "tag",
      },
    ]);
  });

  test("no `deploy` section at all is a project that deploys nothing", () => {
    expect(resolveDeployJobs(undefined)).toEqual({ jobs: [], problems: [] });
    expect(resolveDeployJobs({ your_workflow: "cd.yml" })).toEqual({ jobs: [], problems: [] });
  });

  /**
   * The whole reason there are three lists. A `tags:` on a merge entry is a
   * deployment that will never happen, and under one list with an `on:` key that had
   * to be a validation rule somebody reads after writing it.
   */
  describe("a key only exists in the list it belongs to", () => {
    test("`tags` is not a key an `on_merge` entry has", () => {
      const { problems } = resolveDeployJobs({ on_merge: [{ ...SHIP, tags: ["v*"] }] });
      expect(problems[0]).toContain("unknown key");
      expect(problems[0]).toContain("`tags`");
    });

    test("`branches` is not a key an `on_tag` entry has", () => {
      const { problems } = resolveDeployJobs({ on_tag: [{ ...SHIP, tags: ["v*"], branches: ["main"] }] });
      expect(problems[0]).toContain("unknown key");
      expect(problems[0]).toContain("`branches`");
    });

    test("`on_demand` has neither", () => {
      expect(resolveDeployJobs({ on_demand: [{ ...SHIP, branches: ["main"] }] }).problems[0]).toContain("unknown key");
      expect(resolveDeployJobs({ on_demand: [{ ...SHIP, tags: ["v*"] }] }).problems[0]).toContain("unknown key");
    });
  });

  /** A tag entry with no pattern would deploy on every tag in the repository. */
  test("a tag entry must say which tags", () => {
    const { problems } = resolveDeployJobs({ on_tag: [SHIP] });
    expect(problems[0]).toContain("`tags` needs at least one pattern");
  });

  /** A merge entry with no branch is the ordinary case: the default branch. */
  test("a merge entry need not say which branches", () => {
    expect(jobsOf({ on_merge: [SHIP] })[0]?.refs).toEqual([]);
  });

  /**
   * A name is how a dispatch asks for one deployment, so two lists sharing one would
   * make `--target` ambiguous -- and the wrong answer there deploys something nobody
   * asked for.
   */
  test("a name is unique across the lists, not within one", () => {
    const { problems } = resolveDeployJobs({ on_merge: [SHIP], on_tag: [{ ...SHIP, tags: ["v*"] }] });
    expect(problems[0]).toContain("already declared in another");
  });

  /**
   * Nothing is returned when anything is wrong. A half-honoured list is the worst
   * outcome available: the run reports success having skipped the one that mattered.
   */
  test("one unusable entry withholds all of them", () => {
    const { jobs, problems } = resolveDeployJobs({ on_merge: [SHIP, { name: "broken", commands: [] }] });
    expect(jobs).toEqual([]);
    expect(problems).not.toEqual([]);
  });

  test("a credential the deploy job's own environment uses is refused", () => {
    const { problems } = resolveDeployJobs({ on_merge: [{ ...SHIP, secrets: ["ATOMATON_DEPLOY_TARGET"] }] });
    expect(problems[0]).toContain("already part of the environment");
  });
});

describe("refPatternProblem", () => {
  test("a literal and a trailing star are the two forms", () => {
    expect(refPatternProblem("v1.0.0")).toBe("");
    expect(refPatternProblem("v*")).toBe("");
    expect(refPatternProblem("release/*")).toBe("");
  });

  /** `v*.*.*` is the natural way to write a semver tag, and it matches nothing. */
  test("a star anywhere else is refused, because it would match nothing", () => {
    expect(refPatternProblem("v*.*.*")).toContain("other than the end");
    expect(refPatternProblem("v?.0.0")).toContain("glob character");
  });
});

describe("refMatches", () => {
  test("a literal is exact", () => {
    expect(refMatches("main", "main")).toBe(true);
    expect(refMatches("main", "maintenance")).toBe(false);
  });

  test("a trailing star is a prefix, and crosses a slash", () => {
    expect(refMatches("v*", "v1.2.3")).toBe(true);
    expect(refMatches("release/*", "release/2024/q1")).toBe(true);
    expect(refMatches("v*", "1.2.3")).toBe(false);
  });
});

describe("selectDeployJobs", () => {
  const jobs = jobsOf({
    on_merge: [
      { name: "release", commands: ["./release.sh"] },
      { name: "staging", branches: ["develop"], commands: ["./stage.sh"] },
    ],
    on_tag: [{ name: "production", tags: ["v*"], commands: ["./prod.sh"] }],
    on_demand: [{ name: "rollback", commands: ["./rollback.sh"] }],
  });
  const names = (selected: ReturnType<typeof selectDeployJobs>) => selected?.map((job) => job.name);

  describe("a pushed ref", () => {
    test("a tag deploys the entries whose patterns claim it", () => {
      expect(names(selectDeployJobs(jobs, request({ ref: "refs/tags/v1.0.0" })))).toEqual(["production"]);
    });

    test("a tag nobody asked for deploys nothing, and that is not a failure", () => {
      expect(selectDeployJobs(jobs, request({ ref: "refs/tags/nightly-1" }))).toEqual([]);
    });

    /**
     * The whole of #818. The workflow used to listen on `main` and `master` only, so
     * a person's merge to `develop` started no run at all and `branches: [develop]`
     * could not have worked even if it had existed.
     */
    test("a branch deploys the entries whose `branches` cover it", () => {
      expect(names(selectDeployJobs(jobs, request({ ref: "refs/heads/develop" })))).toEqual(["staging"]);
    });

    test("naming no branches means the default branch, and only that one", () => {
      expect(names(selectDeployJobs(jobs, request({ ref: "refs/heads/main" })))).toEqual(["release"]);
      expect(selectDeployJobs(jobs, request({ ref: "refs/heads/some-feature" }))).toEqual([]);
    });

    /** A repository whose default branch is not `main` deploys from its own. */
    test("the default branch is the repository's, not a guess", () => {
      const req = request({ ref: "refs/heads/trunk", defaultBranch: "trunk" });
      expect(names(selectDeployJobs(jobs, req))).toEqual(["release"]);
    });
  });

  describe("a dispatch", () => {
    const dispatch = (over: Partial<DeployRequest>) =>
      request({ event: "workflow_dispatch", ref: "refs/heads/main", ...over });

    /** `dispatchCd` sends this: an agent's merge fires no `push` for anything to catch. */
    test("`trigger=merge` selects the merge entries for that branch", () => {
      expect(names(selectDeployJobs(jobs, dispatch({ trigger: "merge" })))).toEqual(["release"]);
    });

    test("naming a target deploys exactly that one, from any list", () => {
      for (const target of ["release", "production", "rollback"]) {
        expect(names(selectDeployJobs(jobs, dispatch({ target })))).toEqual([target]);
      }
    });

    /**
     * Null rather than an empty list. Somebody asked for a specific deployment and it
     * is not there; deploying something else instead is worse than deploying nothing,
     * and reporting nothing at all hides a typo in a target's name.
     */
    test("a target that does not exist is an error, not an empty selection", () => {
      expect(selectDeployJobs(jobs, dispatch({ target: "prodcution" }))).toBeNull();
    });

    /** Naming no target is what `on_demand` means: the whole list, in declared order. */
    test("naming nothing runs the on_demand list", () => {
      expect(names(selectDeployJobs(jobs, dispatch({ trigger: "demand" })))).toEqual(["rollback"]);
      expect(names(selectDeployJobs(jobs, dispatch({})))).toEqual(["rollback"]);
    });
  });
});

/**
 * `dispatchCd` knows less than the run does, and both unknowns resolve towards
 * starting a run: a wasted runner minute against a deployment lost in silence.
 */
describe("mergeMightDeploy", () => {
  const jobs = jobsOf({
    on_merge: [
      { name: "release", commands: ["a"] },
      { name: "staging", branches: ["develop"], commands: ["a"] },
    ],
    on_tag: [{ name: "production", tags: ["v*"], commands: ["a"] }],
  });

  test("a branch an entry names", () => {
    expect(mergeMightDeploy(jobs, "develop")).toBe(true);
  });

  test("a branch no entry names still might be the default branch's", () => {
    expect(mergeMightDeploy(jobs, "anything")).toBe(true);
  });

  test("an unknown branch is not an answer of no", () => {
    expect(mergeMightDeploy(jobs, "")).toBe(true);
  });

  test("a project with nothing on merge starts no run", () => {
    expect(mergeMightDeploy(jobsOf({ on_tag: [{ name: "p", tags: ["v*"], commands: ["a"] }] }), "main")).toBe(false);
    expect(mergeMightDeploy([], "main")).toBe(false);
  });

  /** Naming a branch means that branch: a project deploying only from `develop`
   * should not start a run for every merge elsewhere. */
  test("named branches still narrow when the branch is known", () => {
    const onlyStaging = jobsOf({ on_merge: [{ name: "staging", branches: ["develop"], commands: ["a"] }] });
    expect(mergeMightDeploy(onlyStaging, "develop")).toBe(true);
    expect(mergeMightDeploy(onlyStaging, "main")).toBe(false);
  });
});

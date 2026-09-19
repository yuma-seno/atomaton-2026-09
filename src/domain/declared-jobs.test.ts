import { describe, expect, test } from "bun:test";
import { DEFAULT_RUNNER, resolveDeclaredJobs } from "./declared-jobs.ts";

const CREDENTIALLED = { where: "checks.from_default_branch", secretsAllowed: true };
const PULL_REQUEST = { where: "checks.from_pull_request", secretsAllowed: false };

/**
 * These decide what a token can reach and what a check is allowed to skip, so every
 * refusal below is a job that would otherwise have run.
 */
describe("resolveDeclaredJobs", () => {
  test("a declared job keeps its name, commands and secrets", () => {
    const { jobs, problems } = resolveDeclaredJobs(
      [{ name: "cloud-names", commands: ["./check.sh"], secrets: ["AWS_ROLE_ARN"] }],
      CREDENTIALLED,
    );
    expect(problems).toEqual([]);
    expect(jobs).toEqual([
      { name: "cloud-names", runsOn: [DEFAULT_RUNNER], commands: ["./check.sh"], secrets: ["AWS_ROLE_ARN"] },
    ]);
  });

  /** Declaring none is the shipped default, and it is an answer rather than a fault. */
  test("no jobs is not a problem", () => {
    expect(resolveDeclaredJobs(undefined, CREDENTIALLED)).toEqual({ jobs: [], problems: [] });
    expect(resolveDeclaredJobs([], CREDENTIALLED)).toEqual({ jobs: [], problems: [] });
  });

  test("a list that is not a list says so, and names itself", () => {
    const { problems } = resolveDeclaredJobs("cloud-names", PULL_REQUEST);
    expect(problems[0]).toContain("must be an array");
    expect(problems[0]).toContain("checks.from_pull_request");
  });

  describe("the one thing that differs between lists", () => {
    /**
     * The trust boundary, as a shape rather than a rule. A pull request may rewrite
     * any command it declares, so a credential beside one is a credential the change
     * being judged can read.
     */
    test("a secret named where the pull request's own commands run is refused", () => {
      const { jobs, problems } = resolveDeclaredJobs(
        [{ name: "lint", commands: ["bun run lint"], secrets: ["NPM_TOKEN"] }],
        PULL_REQUEST,
      );
      expect(jobs).toEqual([]);
      expect(problems[0]).toContain("cannot be named here");
      expect(problems[0]).toContain("may rewrite them");
    });

    /**
     * Refused rather than dropped. A credential silently ignored is a job that
     * behaves as though it had one until the command needing it fails, and the reason
     * is in neither the log nor the configuration.
     */
    test("and it is refused, not quietly discarded", () => {
      const { jobs } = resolveDeclaredJobs(
        [{ name: "lint", commands: ["bun run lint"], secrets: ["NPM_TOKEN"] }],
        PULL_REQUEST,
      );
      expect(jobs).toEqual([]);
    });

    test("naming none is fine on either side", () => {
      const { jobs, problems } = resolveDeclaredJobs([{ name: "lint", commands: ["x"] }], PULL_REQUEST);
      expect(problems).toEqual([]);
      expect(jobs[0]?.secrets).toEqual([]);
    });
  });

  describe("where it runs", () => {
    test("omitted is the default runner, so an ordinary entry says nothing about machines", () => {
      const { jobs } = resolveDeclaredJobs([{ name: "lint", commands: ["x"] }], PULL_REQUEST);
      expect(jobs[0]?.runsOn).toEqual([DEFAULT_RUNNER]);
    });

    test("a string is one label", () => {
      const { jobs } = resolveDeclaredJobs([{ name: "mac", runs_on: "macos-latest", commands: ["x"] }], PULL_REQUEST);
      expect(jobs[0]?.runsOn).toEqual(["macos-latest"]);
    });

    /** A self-hosted runner is addressed by a set of labels one machine must have all of. */
    test("a list is one runner that must carry every label", () => {
      const { jobs } = resolveDeclaredJobs(
        [{ name: "gpu", runs_on: ["self-hosted", "linux", "gpu"], commands: ["x"] }],
        PULL_REQUEST,
      );
      expect(jobs[0]?.runsOn).toEqual(["self-hosted", "linux", "gpu"]);
    });

    /**
     * An unusable value still produces a job, on the default runner, and says so. A
     * workflow that cannot start reports nothing about why it could not.
     */
    test("an unusable value falls back and is reported rather than failing the list", () => {
      const { jobs, problems } = resolveDeclaredJobs([{ name: "odd", runs_on: 7, commands: ["x"] }], PULL_REQUEST);
      expect(jobs[0]?.runsOn).toEqual([DEFAULT_RUNNER]);
      expect(problems[0]).toContain("runs_on must be a string or a list");
    });
  });

  describe("what makes an entry unusable", () => {
    /**
     * A job with nothing to run passes, and something that always passes is the shape
     * every guard here has failed in: it looks like cover and is not.
     */
    test("a job with no commands is refused rather than left to pass", () => {
      const { jobs, problems } = resolveDeclaredJobs([{ name: "empty", commands: [] }], CREDENTIALLED);
      expect(jobs).toEqual([]);
      expect(problems[0]).toContain("report success");
    });

    /**
     * The name becomes a GitHub job name, and two entries sharing one would leave a
     * person unable to tell which failed.
     */
    test("two jobs cannot share a name", () => {
      const { problems } = resolveDeclaredJobs(
        [{ name: "same", commands: ["a"] }, { name: "same", commands: ["b"] }],
        CREDENTIALLED,
      );
      expect(problems[0]).toContain("declared more than once");
    });

    test("a name GitHub cannot show as written is refused", () => {
      expect(resolveDeclaredJobs([{ name: "Cloud Names", commands: ["a"] }], CREDENTIALLED).problems[0]).toContain(
        "lowercase",
      );
    });

    /**
     * A misspelled key is silently nothing, and the job then runs without whatever it
     * was meant to carry — `secret:` for `secrets:` starts a job with no credential
     * and fails somewhere further in, for a reason nothing names.
     */
    test("an unknown key is a typo, and is refused as one", () => {
      const { jobs, problems } = resolveDeclaredJobs(
        [{ name: "x", commands: ["a"], secret: ["NPM_TOKEN"] }],
        CREDENTIALLED,
      );
      expect(jobs).toEqual([]);
      expect(problems[0]).toContain("unknown key");
      expect(problems[0]).toContain("`secret`");
    });

    /** A list that owns extra keys says so, and they stop being typos. */
    test("keys its owner declares are allowed", () => {
      const { problems } = resolveDeclaredJobs(
        [{ name: "staging", commands: ["a"], branches: ["develop"] }],
        { where: "deploy.on_merge", secretsAllowed: true, extraKeys: ["branches"] },
      );
      expect(problems).toEqual([]);
    });

    /**
     * One malformed entry does not hide the rest: somebody fixing their configuration
     * should see everything wrong with it, not the first thing.
     */
    test("every problem is reported, not the first", () => {
      const { problems } = resolveDeclaredJobs(
        [{ name: "UPPER", commands: ["a"] }, { name: "fine", commands: [] }],
        CREDENTIALLED,
      );
      expect(problems).toHaveLength(2);
    });
  });
});

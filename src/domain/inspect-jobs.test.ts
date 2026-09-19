import { describe, expect, test } from "bun:test";
import { resolveInspectJobs } from "./inspect-jobs.ts";

/**
 * These are the checks that may hold a credential, so what this accepts decides what
 * a token can reach. Every refusal below is a job that would otherwise have run.
 */
describe("resolveInspectJobs", () => {
  test("a declared job keeps its name, commands and secrets", () => {
    const { jobs, problems } = resolveInspectJobs([
      { name: "cloud-names", commands: ["./check.sh"], secrets: ["AWS_ROLE_ARN"] },
    ]);
    expect(problems).toEqual([]);
    expect(jobs).toEqual([{ name: "cloud-names", commands: ["./check.sh"], secrets: ["AWS_ROLE_ARN"] }]);
  });

  /** Declaring none is the shipped default, and it is an answer rather than a fault. */
  test("no jobs is not a problem", () => {
    expect(resolveInspectJobs(undefined)).toEqual({ jobs: [], problems: [] });
    expect(resolveInspectJobs([])).toEqual({ jobs: [], problems: [] });
  });

  /**
   * A job with nothing to run passes, and a check that always passes is the shape
   * every guard here has failed in: it looks like cover and is not.
   */
  test("a job with no commands is refused rather than left to pass", () => {
    const { jobs, problems } = resolveInspectJobs([{ name: "empty", commands: [], secrets: [] }]);
    expect(jobs).toEqual([]);
    expect(problems[0]).toContain("pass without checking anything");
  });

  /**
   * The name becomes a GitHub job name and a matrix entry, and two entries sharing
   * one would leave a person unable to tell which check failed.
   */
  test("two jobs cannot share a name", () => {
    const { problems } = resolveInspectJobs([
      { name: "same", commands: ["a"] },
      { name: "same", commands: ["b"] },
    ]);
    expect(problems[0]).toContain("declared more than once");
  });

  test("a name GitHub cannot show as written is refused", () => {
    expect(resolveInspectJobs([{ name: "Cloud Names", commands: ["a"] }]).problems[0]).toContain("lowercase");
  });

  /**
   * One malformed entry does not hide the rest: a person fixing their configuration
   * should see everything wrong with it, not the first thing.
   */
  test("every problem is reported, not the first", () => {
    const { problems } = resolveInspectJobs([
      { name: "UPPER", commands: ["a"] },
      { name: "fine", commands: [] },
    ]);
    expect(problems).toHaveLength(2);
  });

  test("a list that is not a list says so", () => {
    expect(resolveInspectJobs("cloud-names").problems[0]).toContain("must be an array");
  });
});

import { describe, expect, test } from "bun:test";
import { parseAcrossReleases, toArgv } from "./cli.ts";

/**
 * The two planning scripts are run by a workflow that came from a different tree
 * than they did, so for one cycle during an upgrade the workflow is a release
 * ahead. Measured on the self-deploy pull request for v0.1.156: the new workflow
 * passed `--repo`, the default branch still held v0.1.155's `plan_deploy.ts`, and
 * `parseArgs` threw `ERR_PARSE_ARGS_UNKNOWN_OPTION`.
 */
describe("parseAcrossReleases", () => {
  test("reads the flags it knows", () => {
    expect(parseAcrossReleases(["ref", "event"], ["--ref", "refs/heads/main", "--event", "push"])).toEqual({
      ref: "refs/heads/main",
      event: "push",
    });
  });

  test("a flag it has not learned yet does not stop it", () => {
    expect(parseAcrossReleases(["ref"], ["--ref", "x", "--repo", "o/r"])).toEqual({ ref: "x" });
  });

  /** "Ignored a flag" and "there was no flag" must not look alike afterwards. */
  test("and it says so", () => {
    const said: string[] = [];
    const error = console.error;
    console.error = (message: string) => said.push(message);
    try {
      parseAcrossReleases(["ref"], ["--ref", "x", "--repo", "o/r"]);
    } finally {
      console.error = error;
    }
    expect(said.join("\n")).toContain("::warning::");
    expect(said.join("\n")).toContain("`--repo`");
  });

  test("a flag that is absent is empty, which is what every caller already means by absent", () => {
    expect(parseAcrossReleases(["ref", "target"], ["--ref", "x"])).toEqual({ ref: "x", target: "" });
  });

  test("`--flag=value` is one token", () => {
    expect(parseAcrossReleases(["ref"], ["--ref=refs/tags/v1"])).toEqual({ ref: "refs/tags/v1" });
  });

  /** An empty value is what the workflow passes for an input nobody filled in. */
  test("an empty value stays empty rather than eating the next flag", () => {
    expect(parseAcrossReleases(["target", "trigger"], ["--target", "", "--trigger", "merge"])).toEqual({
      target: "",
      trigger: "merge",
    });
  });

  test("nothing at all is every flag empty", () => {
    expect(parseAcrossReleases(["ref"], [])).toEqual({ ref: "" });
  });
});

describe("toArgv", () => {
  test("builds `--flag \"value\"` pairs and drops what is undefined", () => {
    expect(toArgv({ ref: "main", target: undefined, count: 2 })).toEqual(['--ref', '"main"', "--count", '"2"']);
  });
});

/**
 * own-pipeline.test.ts — this repository's own `deploy` entries, held to what a
 * runner actually needs of them.
 *
 * ## The failure this exists for
 *
 * Splitting the release into `tag-release.sh` and `publish-release.sh` created two
 * new files, `chmod +x` was run on them, and the mode never reached git: this
 * repository is developed on Windows, where `core.fileMode` is false and a mode
 * change is simply not recorded. Everything passed — typecheck, 1137 tests, every
 * check on the pull request — and the deployment failed on the merge with
 *
 *     bash: line 1: ./scripts/tag-release.sh: Permission denied
 *
 * A command written as `./script` is one the runner executes rather than interprets,
 * so the bit is part of the contract and nothing else was checking it. The mode is
 * invisible in a diff on this platform, which is what makes it worth a test rather
 * than a habit.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveDeployJobs } from "../../src/domain/delivery/deploy-jobs.ts";

/** The live configuration, which is what the runner reads. */
function deployCommands(): string[] {
  const config = Bun.YAML.parse(readFileSync(".github/atomaton/config.yaml", "utf8")) as { deploy?: unknown };
  const { jobs, problems } = resolveDeployJobs(config.deploy);
  expect(problems, "this repository's own deploy section does not resolve").toEqual([]);
  return jobs.flatMap((job) => job.commands);
}

/** The mode git records for `path`, or "" when git does not track it. */
function recordedMode(path: string): string {
  const result = spawnSync("git", ["ls-files", "-s", "--", path], { encoding: "utf8" });
  return (result.stdout ?? "").trim().split(/\s+/)[0] ?? "";
}

describe("this repository's own deployments", () => {
  /**
   * `./script` is executed, not interpreted — no `bash` in front of it — so the file
   * has to carry the bit. `bash scripts/x.sh` does not, which is why this looks at
   * how the command is written rather than at every file in the directory.
   */
  test("every script a command executes directly is executable in git", () => {
    const direct = deployCommands()
      .map((command) => /^\.\/(\S+)/.exec(command.trim())?.[1])
      .filter((path): path is string => Boolean(path));

    expect(direct.length, "no deployment executes a script, so this checks nothing").toBeGreaterThan(0);
    for (const path of direct) {
      expect(recordedMode(path), `${path} is executed as a command but is not executable in git`).toBe("100755");
    }
  });
});

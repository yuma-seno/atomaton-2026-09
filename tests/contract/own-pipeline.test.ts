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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * A release script's idea of where the repository root is.
 *
 * `check-live-tools.sh` derived it as `dirname "${BASH_SOURCE[0]}"/..`, which was
 * right while it sat in `scripts/` at the repository root and wrong the moment it
 * moved to `.github/atomaton/scripts/`. The parent of its directory became
 * `.github/atomaton/`, the `cd` landed there, and the first line that reads `src/`
 * failed — in the publish, after the tag had already been created.
 *
 * Nothing caught it. Every REFERENCE to the script was updated with the move; what
 * moved silently was the path it derives FROM ITSELF, which no reference names and
 * no type mentions.
 *
 * A count of `..` is a claim about where a file lives. `git rev-parse
 * --show-toplevel` is a question, and it has the same answer from anywhere in the
 * checkout.
 */
describe("the release scripts and where they think they are", () => {
  const scripts = readdirSync("self/atomaton/scripts")
    .filter((name) => name.endsWith(".sh"))
    .map((name) => join("self/atomaton/scripts", name));

  test("there are scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test.each(scripts)("%s does not count its way to the repository root", (path) => {
    // Comment lines dropped first. The script that caused this explains the old
    // form in its own header, and a test that reads a warning as the thing it
    // warns about is a test nobody can satisfy.
    const code = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    const derived = /BASH_SOURCE\[0\][^\n]*\.\./.exec(code)?.[0];
    expect(
      derived,
      `${path} works out the repository root by counting \`..\` from its own location, ` +
        `so it breaks the next time it moves. Ask git: \`git rev-parse --show-toplevel\``,
    ).toBeUndefined();
  });
});

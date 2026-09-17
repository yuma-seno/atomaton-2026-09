import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * test-script.test.ts — every directory `bun run test` names is a directory.
 *
 * ## What this is here for
 *
 * `bun test <path that does not exist>` does not fail. It runs the paths it
 * finds, reports them, and exits 0. So a `test` script naming a directory that
 * has moved runs a smaller suite than it says it does, and the only visible
 * symptom is a number nobody is comparing against anything.
 *
 * That happened. The tool servers moved from `.github/atoma/tools/scripts/` to
 * `.github/atoma-runtime/tools/`, the `test` script kept the old path, and
 * `mcp.test.ts` and `shell_guard.test.ts` stopped running -- in CI, which is the
 * only place they CAN run, because they spawn subprocesses that need a POSIX
 * shell. Every release since went out with the tool servers and the shell guard
 * untested, and CI was green for all of them. The later rename moved the stale
 * path to a new stale path without noticing it was stale.
 *
 * Checking the count would not have caught it either: nobody knows what the
 * number should be. Checking that the paths EXIST is the assertion that has an
 * answer.
 */
describe("the test script", () => {
  const script = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;

  /** The arguments to `bun test`, which are paths. The command itself is not. */
  function pathsOf(command: string): string[] {
    return command
      .split(/\s+/)
      .slice(2)
      .filter((word) => word.startsWith("./") || word.startsWith("src/") || word.startsWith("tests/"));
  }

  for (const name of ["test", "test:e2e"]) {
    test(`\`${name}\` names only paths that exist`, () => {
      const command = script[name];
      expect(command, `package.json has no \`${name}\` script`).toBeDefined();
      const paths = pathsOf(command!);
      expect(paths.length, `\`${name}\` names no paths at all`).toBeGreaterThan(0);
      const missing = paths.filter((path) => !existsSync(path));
      expect(
        missing,
        `\`bun test\` exits 0 on a path that does not exist, so these run nothing and say nothing. ` +
          `Point them at where the files moved to`,
      ).toEqual([]);
    });
  }

  /**
   * Named rather than derived from a walk: the point is that these two suites in
   * particular were the ones silently dropped, and they are the ones that cannot
   * run anywhere but CI.
   */
  test("the suites that only CI can run are among them", () => {
    const covered = pathsOf(script.test!);
    for (const suite of ["src/atomaton-runtime/tools/mcp/mcp.test.ts", "src/atomaton-runtime/tools/hooks/shell_guard.test.ts"]) {
      expect(existsSync(suite), `${suite} has moved; this test needs the new path`).toBe(true);
      expect(
        covered.some((path) => suite.startsWith(path.replace(/^\.\//, ""))),
        `${suite} is not under any path \`bun run test\` names, so CI does not run it`,
      ).toBe(true);
    }
  });
});

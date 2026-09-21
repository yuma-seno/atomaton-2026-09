/**
 * workflow-sources.test.ts — the workflow build reads this repository's own
 * `src/workflows/`, and nothing else on the disk.
 *
 * This happened. The generator used to find its input by globbing the working
 * directory for `*.wac.ts`, dotfiles included. Every agent gets a git worktree
 * under `.claude/worktrees/`, each one a full copy of `src/workflows/` on
 * ANOTHER BRANCH, and all of the copies wrote into the same
 * `dist/.github/workflows/`: the last one won. No error, no warning, exit 0,
 * valid YAML. `.claude/` is untracked and `dist/` is gitignored, so there is no
 * diff in which anybody could see it -- and `dist/` is the release, from which
 * `.github/workflows/` is updated by self-deploy. Issue #952.
 *
 * Two ends of the same fact are held here, because either alone is decoration:
 * that the discovery refuses anything outside the tree, and that the discovery
 * is what the build actually runs.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WORKFLOW_SOURCE_DIR, workflowSourceFiles } from "../../src/synth-workflows.ts";
import wacConfig from "../../wac.config.ts";

const fixture = mkdtempSync(join(tmpdir(), "atomaton-workflow-sources-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

/** Writes `path` (fixture-relative) with placeholder content, creating its directories. */
function place(path: string): void {
  const absolute = join(fixture, ...path.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, "// fixture\n");
}

describe("workflow sources", () => {
  /**
   * The decoys are the real ones, in the shape they really take: a sibling agent
   * worktree under `.claude/`, the adopter examples (kept as plain YAML today,
   * which is a choice someone could revisit), and a dependency's own fixture.
   * All three were inside the old glob's reach; `node_modules` was the single
   * exclusion it had.
   */
  test("a .wac.ts outside the workflow tree is not input, wherever it sits", () => {
    place(`${WORKFLOW_SOURCE_DIR}/atomaton-thing.wac.ts`);
    place(`${WORKFLOW_SOURCE_DIR}/nested/deeper.wac.ts`);
    place(`${WORKFLOW_SOURCE_DIR}/actions/helper.ts`);
    place(`.claude/worktrees/wf_1234/${WORKFLOW_SOURCE_DIR}/atomaton-thing.wac.ts`);
    place(`examples/workflows/scheduled-issue.wac.ts`);
    place(`node_modules/some-package/test.wac.ts`);

    expect(workflowSourceFiles(fixture)).toEqual([
      `${WORKFLOW_SOURCE_DIR}/atomaton-thing.wac.ts`,
      `${WORKFLOW_SOURCE_DIR}/nested/deeper.wac.ts`,
    ]);
  });

  /** A file filed one directory deeper is generated, not silently skipped. */
  test("the bound is the tree, not its top level", () => {
    expect(workflowSourceFiles(fixture)).toContain(`${WORKFLOW_SOURCE_DIR}/nested/deeper.wac.ts`);
  });

  /**
   * Against the real repository, so that a source file added, moved out, or filed
   * under a directory the generator does not visit is a failure here rather than
   * a workflow that stops being generated with nothing to show for it.
   */
  test("every workflow source of this repository is one of them", () => {
    const sources = workflowSourceFiles(process.cwd());
    expect(sources.length, "there are workflow sources to generate").toBeGreaterThan(0);
    for (const source of sources) expect(existsSync(source), source).toBe(true);
    expect(sources).toContain(`${WORKFLOW_SOURCE_DIR}/atomaton-runner.wac.ts`);
  });

  /**
   * The link between the two. Bounded discovery that the build does not call is
   * a function with a test and no effect, and the build called `gwf build` --
   * whose own discovery is the unbounded glob, hardcoded in the CLI with no
   * config key that narrows it.
   */
  test("`synth` generates through the bounded discovery and not the CLI's glob", () => {
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.synth).toContain("src/synth-workflows.ts");
    expect(scripts.synth, "`gwf build` globs the whole working directory").not.toContain("gwf");
  });

  /**
   * And the artifact itself, which is where the defect was visible if anyone had
   * looked: a workflow generated from a sibling worktree carried that worktree's
   * path in its own header.
   *
   * The line is derived from the configured header rather than typed again here.
   * It is also what an adopter follows from a generated file in their own
   * repository back into this one, so it is checked for being a path they can
   * follow -- upstream-relative and POSIX -- and not merely for being present.
   * Built on Windows it used to read `src\workflows\...`, which made the
   * deliverable differ by the machine that produced it.
   */
  test("every generated workflow names the source in this repository it came from", () => {
    const template = (wacConfig.headerText ?? []).find((line) => line.includes("<source-file-path>"));
    expect(template, "the header names its source file").toBeDefined();
    const [before, after] = (template as string).split("<source-file-path>") as [string, string];

    const generated = readdirSync("dist/.github/workflows").filter((f) => f.endsWith(".yml"));
    expect(generated.length, "run `bun run synth` first").toBeGreaterThan(0);

    for (const file of generated) {
      const line = readFileSync(join("dist/.github/workflows", file), "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith(before));
      expect(line, `${file} has no generated-from header`).toBeDefined();

      const source = (line as string).slice(before.length, (line as string).length - after.length);
      expect(source, `${file} was generated from outside ${WORKFLOW_SOURCE_DIR}/`).toStartWith(`${WORKFLOW_SOURCE_DIR}/`);
      expect(existsSync(source), `${file} names ${source}, which is not in this repository`).toBe(true);
    }
  });
});

/**
 * machinery-root.test.ts — one place resolves which tree the machinery is in.
 *
 * ## The failure this exists for
 *
 * Every path in `domain/machinery-layout.ts` is relative, and what they resolve
 * against was worked out in three places by hand:
 *
 *   `lib/config.ts`             `root ? `${root}/${CONFIG_FILE}` : CONFIG_FILE`
 *   `check_live_tools.ts`       `process.env.ATOMATON_MACHINERY_ROOT?.trim() || "."`
 *   `write_metrics_report.ts`   the same line again
 *
 * with the variable's name typed out beside each, and beside five more spellings in
 * the shell the workflow generator writes. Three answers to one question, differing
 * in what an unset value means, and no way for them to change together.
 *
 * What makes it worth a test rather than a tidy-up is what the variable decides.
 * Whether the tree it names may be believed is a property of the JOB — the runner
 * sets it so a pull request cannot choose which agent reviews it, and
 * `atomaton-check` leaves it unset so a pull request's own arm reads its own
 * commands. A fourth reader that resolved it slightly differently would be choosing
 * a trust level while looking like a path join.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MACHINERY_ROOT_VAR } from "../../src/domain/machinery-layout.ts";

/**
 * Where the name is declared, and where it is read.
 *
 * Nothing else spells it — not even the module that resolves it, which imports the
 * constant and indexes `process.env` with it.
 */
const DECLARES_IT = "src/domain/machinery-layout.ts";
const RESOLVES_IT = "src/lib/machinery.ts";

/** Every `.ts` under `src/`, tests excluded. */
function sourceFiles(): string[] {
  return readdirSync("src", { recursive: true })
    .map(String)
    .map((name) => join("src", name).replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
}

/**
 * The lines that are code.
 *
 * Comments are left out on purpose: four file headers explain this variable, and they
 * should. What must not spread is a line that USES the name — a second resolution, or
 * a shell string with it typed in.
 */
function codeLines(source: string): string[] {
  return source
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"));
}

describe("which tree the machinery is in", () => {
  test("only one module names the variable in code", () => {
    const named = sourceFiles()
      .filter((path) => path !== DECLARES_IT)
      .filter((path) => codeLines(readFileSync(path, "utf8")).some((line) => line.includes(MACHINERY_ROOT_VAR)));

    expect(
      named,
      `import MACHINERY_ROOT_VAR instead of spelling it: ${named.join(", ")}`,
    ).toEqual([]);
  });

  test("only one module reads it from the environment", () => {
    const reads = sourceFiles().filter((path) =>
      /process\.env\s*[.[]\s*(MACHINERY_ROOT_VAR|["']?ATOMATON_MACHINERY_ROOT)/.test(readFileSync(path, "utf8")),
    );

    expect(
      reads,
      `use machineryRoot()/machineryPath() instead of resolving it again: ${reads.join(", ")}`,
    ).toEqual([RESOLVES_IT]);
  });
});

/**
 * script-refs.test.ts — a script may not import another script's `ref`.
 *
 * ## The failure this exists for
 *
 * `scripts/lib/script-ref.ts` derives a script's deployed path from
 * `import.meta.url`, so a rename moves the path with the file and no call site types
 * one out. That works for `src/workflows/*.wac.ts`, which is what it was built for:
 * the generator runs unbundled, one module per file.
 *
 * It does not work between scripts. `build-dist.ts` bundles each script in
 * `src/entrypoints/machinery/` separately, and a bundled non-entry module is handed the ENTRY's
 * `import.meta.url` — so the imported `ref` names the importer. Measured while
 * replacing a hand-built path in `check_live_tools.ts`: the bundle came out with
 *
 *     // src/entrypoints/machinery/write_tools_file.ts
 *     var ref = defineScript(import.meta.url);
 *
 * inside `check_live_tools.ts`, which would have spawned `check_live_tools.ts`
 * instead of the writer.
 *
 * What makes it worth a test is that the wrong answer is a real path to a real
 * script. Nothing throws, nothing is missing, and the failure arrives as whatever
 * the wrong program does — which in that case was a script re-entering itself.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every `.ts` directly under `src/entrypoints/machinery/`, tests excluded. `lib/` and `testing/` are not scripts. */
function scripts(): string[] {
  return readdirSync("src/entrypoints/machinery", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name);
}

describe("script refs", () => {
  test("no script imports a sibling script's ref", () => {
    // A relative import of a sibling — `./other.ts` — bringing in `ref`. The `lib/`
    // and `testing/` subdirectories are not scripts and are not bundled as entries,
    // so importing from them is ordinary and is not matched.
    const importsSiblingRef = /import\s*\{[^}]*\bref\b[^}]*\}\s*from\s*["']\.\/[A-Za-z0-9_]+\.ts["']/;

    const offenders = scripts().filter((name) =>
      importsSiblingRef.test(readFileSync(join("src/entrypoints/machinery", name), "utf8")),
    );

    expect(
      offenders,
      "a bundled script's `ref` names the bundle's entry, not the file it was written in: " +
        `build the path from SCRIPTS_DIR instead — ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  /** The intended use, asserted so the rule above is not read as "refs are unusable". */
  test("workflow generators do import them", () => {
    const generators = readdirSync("src/workflows")
      .filter((name) => name.endsWith(".wac.ts"))
      .filter((name) => /ref as \w+Ref/.test(readFileSync(join("src/workflows", name), "utf8")));

    expect(generators.length, "the generators are where a ref belongs").toBeGreaterThan(0);
  });
});

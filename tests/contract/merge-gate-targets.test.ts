/**
 * merge-gate-targets.test.ts — the files this repository's merge gates name, held
 * to the files that exist.
 *
 * ## The failure this exists for
 *
 * A gate says "a change to `src/domain/merge-readiness.ts` is a person's to merge".
 * Move that file and the gate keeps parsing, keeps validating, and matches nothing
 * — so it stops firing, and the only symptom is an agent merging something it
 * should have handed over. Splitting `src/domain/` into four contexts moved three
 * of the four paths this repository's one gate names, and nothing would have said
 * so.
 *
 * That is the shape this repository keeps finding: a guard that silently does not
 * run is indistinguishable from one that passes. `deliverable-integrity.ts`
 * validates a gate's SHAPE — unknown keys are an error, because a typo in
 * `files_added` matches nothing — and this is the other half of that argument
 * applied to the values.
 *
 * ## Both copies
 *
 * The gate in force is the one in the machinery tree, `.github/atomaton/config.yaml`.
 * `self/atomaton/config.yaml` is what the next self-deploy would put back. A path
 * corrected in one and not the other is a gate that works until it is redeployed,
 * or one that does not work until then, so both are read here.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathMatches } from "../../src/domain/delivery/path-patterns.ts";

const CONFIGS = [".github/atomaton/config.yaml", "self/atomaton/config.yaml"];

/** Every file git knows about, for the patterns that are globs rather than paths. */
function trackedFiles(): string[] {
  const listed = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  expect(listed.status, "could not list the repository's files").toBe(0);
  return listed.stdout.split("\n").filter(Boolean);
}

interface Gate {
  reason?: string;
  when?: { files_changed?: string[]; files_added?: string[] };
}

function gatesOf(path: string): Gate[] {
  const config = Bun.YAML.parse(readFileSync(path, "utf8")) as { merge?: { gates?: Gate[] } };
  return config.merge?.gates ?? [];
}

describe.each(CONFIGS)("%s", (config) => {
  const named = gatesOf(config).flatMap((gate) => [
    ...(gate.when?.files_changed ?? []),
    ...(gate.when?.files_added ?? []),
  ]);

  test("names at least one file, or the gate section is empty on purpose", () => {
    expect(gatesOf(config).length === 0 || named.length > 0).toBe(true);
  });

  test.each(named)("a gate names %s, and it is there", (pattern) => {
    const matched = pattern.includes("*")
      ? trackedFiles().some((file) => pathMatches(file, pattern))
      : existsSync(pattern);
    expect(matched, `no file matches the gate pattern ${pattern}; the gate cannot fire`).toBe(true);
  });
});

describe("the two copies", () => {
  test("name the same files, so a deploy does not change which gates fire", () => {
    const [live, overlay] = CONFIGS.map((c) => JSON.stringify(gatesOf(c)));
    expect(overlay).toBe(live);
  });
});

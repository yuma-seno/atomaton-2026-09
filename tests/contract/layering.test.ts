/**
 * layering.test.ts — the arrows point inward, and nothing says so but this.
 *
 * `docs/architecture.md` sorts `src/` into layers and states the rule. Nothing
 * enforced it: `package.json`'s lint is `tsc` and `synth`, and none of the other
 * contract tests reads an import. A layout with no ratchet is a layout that holds
 * until the first change made in a hurry.
 *
 * ## What it cannot see
 *
 * Imports, and only imports. None of the defects the refactor it guards was opened
 * for is visible here — a domain concept defined by a mechanism is a doc comment, a
 * missing `Turn` is a type nobody wrote, and a conflated enum is two meanings in one
 * word. This is the cheap half, kept because it is the half that decays silently.
 *
 * ## Why the contexts inside `domain/` are listed too
 *
 * They are not four peers. Measured when they were split: `delivery` reaches into
 * `work` and `machinery`, `record` reaches into `work`, and the two inner ones reach
 * nowhere. An edge the other way means a module is in the wrong context, which is a
 * thing to decide rather than to add to a list — so the list is here rather than in
 * a comment somebody may widen.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * What each layer may import, by the first segment of the path under `src/`.
 *
 * `entrypoints` is absent because it may import anything: it is the outermost, and a
 * rule saying "everything" is a rule that tells a reader nothing.
 */
const MAY_IMPORT: Readonly<Record<string, readonly string[]>> = {
  domain: ["domain", "shared"],
  shared: ["shared"],
  app: ["domain", "shared", "adapters", "app"],
  adapters: ["domain", "shared", "adapters"],
};

/** Inside `domain/`, by the second segment. The two inner contexts reach nowhere. */
const DOMAIN_MAY_IMPORT: Readonly<Record<string, readonly string[]>> = {
  work: ["work"],
  machinery: ["machinery"],
  delivery: ["delivery", "work", "machinery"],
  record: ["record", "work"],
};

/**
 * The one module in `domain/` that touches the filesystem, and the reason it is named
 * rather than tolerated.
 *
 * `defaults.yaml` ships as data instead of being a TypeScript constant, so something
 * has to read it, and every caller of `toolDefaults()` may pass the path instead. The
 * exception is one file wide and this is where it is counted: an exception nobody
 * counts is a rule that has quietly stopped being one.
 */
const MAY_READ_FILES = ["domain/machinery/shipped-servers.ts"];

/**
 * The built-in modules that reach the world, as opposed to the ones that do arithmetic
 * on strings.
 *
 * `node:path` and `node:url` are not on it, and the distinction is the point rather
 * than a loophole: `join("a", "b")` and `fileURLToPath(u)` answer from their arguments
 * and nothing else, which is the property this whole section is about. Banning them
 * would make the rule easier to state and would stop describing purity.
 */
const REACHES_THE_WORLD = ["node:fs", "node:fs/promises", "node:child_process", "node:os", "node:process", "node:net", "node:http", "node:https"];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Repository-relative, with forward slashes, as a person would write it. */
function named(file: string): string {
  return relative(SRC, file).split(sep).join("/");
}

/** Every relative specifier in `file`, resolved to its path under `src/`. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const [, specifier] of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
    if (specifier !== undefined) found.push(named(resolve(dirname(file), specifier)));
  }
  return found;
}

const FILES = sources(SRC).filter((file) => !file.endsWith(".test.ts"));

describe("the dependency rule", () => {
  test("there are sources to check, so a broken walk cannot pass as a clean tree", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  test.each(Object.keys(MAY_IMPORT))("%s imports only inward", (layer) => {
    const broken: string[] = [];
    for (const file of FILES.filter((f) => named(f).startsWith(`${layer}/`))) {
      for (const target of importsOf(file)) {
        const into = target.split("/")[0] ?? "";
        if (!MAY_IMPORT[layer]!.includes(into)) broken.push(`${named(file)} -> ${target}`);
      }
    }
    expect(broken, `${layer}/ may import ${MAY_IMPORT[layer]!.join(", ")} and nothing else`).toEqual([]);
  });

  test.each(Object.keys(DOMAIN_MAY_IMPORT))("domain/%s imports only inward", (context) => {
    const broken: string[] = [];
    for (const file of FILES.filter((f) => named(f).startsWith(`domain/${context}/`))) {
      for (const target of importsOf(file)) {
        if (!target.startsWith("domain/")) continue;
        const into = target.split("/")[1] ?? "";
        if (!DOMAIN_MAY_IMPORT[context]!.includes(into)) broken.push(`${named(file)} -> ${target}`);
      }
    }
    expect(broken, `domain/${context}/ may reach ${DOMAIN_MAY_IMPORT[context]!.join(", ")}`).toEqual([]);
  });
});

describe("domain and shared are pure", () => {
  /**
   * Not a style rule. A pure module is one a test can call with the input it wants,
   * and it is why `domain/` is where the rules live rather than where they are read
   * from: anything that reaches for a file, a clock or a subprocess has to be given
   * the world before it can answer.
   */
  test.each(["domain", "shared"])("%s reaches for nothing outside its arguments", (layer) => {
    const impure: string[] = [];
    for (const file of FILES.filter((f) => named(f).startsWith(`${layer}/`))) {
      if (MAY_READ_FILES.includes(named(file))) continue;
      const text = readFileSync(file, "utf8");
      for (const [, what] of text.matchAll(/from\s+"(node:[a-z:/]+)"/g)) {
        if (REACHES_THE_WORLD.includes(what!)) impure.push(`${named(file)} imports ${what}`);
      }
      for (const pattern of [/\bprocess\.env\b/, /\bBun\.spawn/, /\bDate\.now\(/, /\bMath\.random\(/, /\bnew Date\(/]) {
        if (pattern.test(text)) impure.push(`${named(file)} uses ${pattern.source}`);
      }
    }
    expect(impure, `${layer}/ must take the world as an argument`).toEqual([]);
  });

  test("the file-reading exception is one module, and it is the one named", () => {
    expect(MAY_READ_FILES).toEqual(["domain/machinery/shipped-servers.ts"]);
    expect(FILES.map(named)).toContain(MAY_READ_FILES[0]!);
  });
});

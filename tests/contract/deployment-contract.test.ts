/**
 * deployment-contract.test.ts — every static Atomaton file reaches the deployed
 * `.github/`.
 *
 * A repository adopts the deliverable by copying it over its own `.github/`:
 *
 *     cp -r dist/.github/. .github/
 *
 * So a file that exists only under `.github/` is not part of the deliverable at
 * all. It keeps working wherever it already sits and is simply missing
 * everywhere else, which leaves no diff and so cannot be caught in review. That
 * is the failure this file exists to make loud, and it is why the check is
 * against `src/atomaton/` and `build-dist.ts` rather than against any deployed
 * tree.
 *
 * This already happened: a PR added a package list under `.github/atomaton/` by hand
 * without adding it to `src/atomaton/` or to build-dist.ts's copy list, while
 * switching tools.yaml to a binary that only that file installs.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ATOMA_SRC = join(process.cwd(), "src/atomaton");
const RUNTIME_TOOLS = join(process.cwd(), "src/atomaton-runtime/tools");
const BUILD_DIST = join(process.cwd(), "src/build-dist.ts");

/** Filenames in build-dist.ts's verbatim-copy list. */
function copiedFiles(): string[] {
  const source = readFileSync(BUILD_DIST, "utf8");
  // The declaration, not the loop that consumes it. Matching the loop broke the
  // moment the list was given a name so that the same array could also decide
  // which leftovers to sweep out of `dist/`.
  const list = /const filesCopiedVerbatim = \[([^\]]*)\]/.exec(source)?.[1];
  if (!list) throw new Error("could not locate build-dist.ts's static copy list (`filesCopiedVerbatim`)");
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/**
 * Loose static files sitting directly in src/atomaton/, i.e. the ones that have to
 * be named in build-dist.ts's copy list. Restricted to shippable data
 * extensions: anything else in there is a stray, which the first test below
 * reports on its own terms rather than as a missing copy-list entry.
 */
function staticFiles(): string[] {
  return readdirSync(ATOMA_SRC, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(json|md|ya?ml)$/.test(e.name))
    .map((e) => e.name);
}

/** Every file under a directory, recursively, repo-relative. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(relative(process.cwd(), path).replaceAll("\\", "/"));
  }
  return out;
}

describe("deployment contract", () => {
  // `src/atomaton/` is the deliverable, mirrored 1:1 into `dist/.github/atomaton/`
  // and from there into an adopter's own `.github/`. Anything that exists to
  // develop THIS repository belongs outside it, which is why these contract
  // tests live under `tests/`.
  //
  // The line, decided deliberately: a test of SHIPPED BEHAVIOUR lives beside the
  // shipped code, because it describes the product. A test of THIS REPO'S
  // build-and-deploy machinery lives here under `tests/`, because it describes
  // the factory. Neither ever ships — build-dist.ts excludes `*.test.ts`.
  //
  // So `src/atomaton-runtime/tools/**` is exempt: `mcp.test.ts` and `shell_guard.test.ts`
  // exercise MCP servers that adopters receive and run, and a template repo that
  // shipped an untested MCP server would be handing adopters untested code.
  test("the deliverable's content directories hold no test files", () => {
    const strays = walk(ATOMA_SRC)
      .filter((f) => /\.test\.ts$|\.spec\.ts$/.test(f))
      .filter((f) => !f.startsWith("src/atomaton-runtime/tools/"));
    expect(strays, `move these out of src/atomaton/: ${strays.join(", ")}`).toEqual([]);
  });

  test("src/atomaton/ and the shipped dist tree hold the same static files", () => {
    const distAtomaton = join(process.cwd(), "dist/.github/atomaton");
    let shipped: string[];
    try {
      statSync(distAtomaton);
      shipped = walk(distAtomaton).map((f) => f.replace("dist/.github/atomaton/", ""));
    } catch {
      // `dist/` is not tracked, so a fresh checkout has none until synth runs.
      // ci.yml builds it before `test` for exactly this reason -- if this branch
      // is being taken in CI, the check has been silently retired rather than
      // satisfied.
      return;
    }

    // Markdown and YAML are copied verbatim, so every one in src must ship.
    const sourceStatic = walk(ATOMA_SRC)
      .map((f) => f.replace("src/atomaton/", ""))
      .filter((f) => f.endsWith(".md") || f.endsWith(".yaml") || f.endsWith(".json"));

    for (const file of sourceStatic) {
      expect(shipped.includes(file), `src/atomaton/${file} never reaches dist/.github/atomaton/`).toBe(true);
    }
  });

  test("build-dist.ts copies every static file in src/atomaton/", () => {
    const copied = copiedFiles();
    const present = staticFiles();

    expect(present.length).toBeGreaterThan(0);
    for (const file of present) {
      expect(
        copied.includes(file),
        `src/atomaton/${file} is not in build-dist.ts's copy list, so it never reaches ` +
          `dist/ and no adopter ever receives it.`,
      ).toBe(true);
    }
  });

  test("build-dist.ts does not claim to copy files that are missing", () => {
    const present = staticFiles();
    for (const file of copiedFiles()) {
      expect(present.includes(file), `build-dist.ts copies src/atomaton/${file}, which does not exist`).toBe(true);
    }
  });

  test("the shipped package list covers every server started by a bare command", () => {
    // A `command:` that is not `bun` is an external binary, and there are only
    // two ways one can exist on a runner: the MCP package step installs it from
    // mcp-packages.json, or the runner image already carries it.
    //
    // The second is a real category and has to be named rather than assumed. It
    // is also the weaker of the two — an image can drop a tool between runner
    // releases and nothing here would notice — so listing them makes adding one
    // a decision instead of an omission.
    // Empty: every server is started with `bun`, so nothing here needs
    // a binary the runner has to supply. `podman` was the one entry, for the
    // container the shell server ran in, and this is the place a reader would look
    // to find out which external programs an adopter's runner must have — so a
    // stale entry here is worse than none.
    const PROVIDED_BY_THE_RUNNER = new Map<string, string>([]);

    // From the shipped defaults, which is where a server's `command` lives now. A
    // project's own servers are not checked here: this is about what the deliverable
    // promises to install for the servers IT ships.
    const defaults = Bun.YAML.parse(readFileSync(join(RUNTIME_TOOLS, "defaults.yaml"), "utf8")) as {
      servers?: Record<string, { command?: unknown }>;
    };
    const commands = Object.values(defaults.servers ?? {})
      .map((server) => server.command)
      .filter((command): command is string => typeof command === "string");
    const external = [...new Set(commands.filter((c) => c !== "bun" && c !== "npx"))];
    const mustBeInstalled = external.filter((c) => !PROVIDED_BY_THE_RUNNER.has(c));

    const packages = JSON.parse(readFileSync(join(RUNTIME_TOOLS, "packages.json"), "utf8")) as {
      npm?: string[];
      pip?: string[];
    };
    const declared = [...(packages.npm ?? []), ...(packages.pip ?? [])].join(" ");

    for (const command of mustBeInstalled) {
      // The npm package name need not equal the binary name, so require only
      // that something is declared to install — an empty list cannot be right.
      expect(
        declared.length > 0,
        `tools.yaml spawns "${command}", and neither mcp-packages.json nor the ` +
          `runner image accounts for it. Install it, or add it to ` +
          `PROVIDED_BY_THE_RUNNER with the reason.`,
      ).toBe(true);
    }
  });
});

/**
 * The machinery's layout is a set of constants, and stays one.
 *
 * Six literals used to sit in the workflow generator while five other files spelled
 * the same strings for themselves -- the config reader, the secret slots, the
 * bundler, the metrics report and the test harness. Nothing failed, because they
 * agreed. That is how a set of literals stays wrong once one of them moves, and it
 * is the shape of defect this repository keeps finding in itself.
 */
describe("the machinery layout is declared once", () => {
  const SOURCES = [
    "src/workflows/atomaton-runner.wac.ts",
    "src/lib/config.ts",
    "src/scripts/write_metrics_report.ts",
    "src/build-dist.ts",
  ];

  /**
   * Only the module itself may spell the root. A message that mentions the path to a
   * person is not a use of it, so this looks for the string in code: quoted with a
   * slash after it, or interpolated.
   */
  test("no source outside the layout module builds a machinery path from a literal", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (/["'`]\.github\/atoma\//.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, "import from domain/machinery/machinery-layout.ts instead").toEqual([]);
  });

  /**
   * `validate_deliverable.ts` is the deliberate exception and must stay one. It
   * validates a pull request's OWN `.github/atomaton/`, which is data to it and never
   * code -- taking its paths from that tree would let a pull request redirect the
   * validation that is judging it.
   */
  test("the validator keeps its own paths", () => {
    const source = readFileSync("src/scripts/validate_deliverable.ts", "utf8");
    // The IMPORT, not the name. Any mention used to fail this, which meant the one
    // file whose independence is deliberate could not say so -- a comment explaining
    // why it does not import the layout was indistinguishable from importing it.
    const imports = [...source.matchAll(/^import .*$/gm)].map((match) => match[0]);
    expect(
      imports.filter((line) => line.includes("machinery-layout.ts")),
      "the validator must derive its paths from the tree it is judging",
    ).toEqual([]);
  });

  /** An adopter opening the directory should find out what each path means there. */
  test("the README ships", () => {
    expect(existsSync("src/atomaton/README.md")).toBe(true);
    expect(readFileSync("src/build-dist.ts", "utf8")).toContain('"README.md"');
  });
});

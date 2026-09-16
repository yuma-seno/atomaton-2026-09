#!/usr/bin/env bun
/**
 * build-dist.ts — Bundles every deployable entry-point script (via
 * `Bun.build`) from its `src/` source into the mirrored `dist/.github/`
 * location:
 *   - `src/scripts/**` (this repo's own workflow-automation glue, invoked
 *     directly from a `*.wac.ts` file's `run:` step) -> `dist/.github/scripts/`.
 *   - `src/atoma/tools/scripts/**` (Atoma's own MCP servers, `before_tool`
 *     hook, and the one-shot scripts they use) -> `dist/.github/atoma/tools/scripts/`.
 *   - Atoma's static, non-code content (`config.yaml`, `prompt-template.md`,
 *     `mcp-packages.json`, agent definitions, recursive skill Markdown, and the
 *     rulesets) -> `dist/.github/atoma/`, copied verbatim (nothing to bundle).
 *
 * The tools file the core reads is NOT built here and does not ship: it is
 * written per run by `scripts/write_tools_file.ts`, from the config. A generated
 * file that is distributed is a second source of truth wearing the clothes of a
 * first -- see that script for what it cost.
 *
 * Every entry point is bundled with ALL of its imports inlined -- including
 * the shared `src/lib/**` kernel (so `src/scripts/**` and
 * `src/atoma/tools/scripts/**` can freely import shared code without any
 * hand-duplicated files between them) and npm dependencies like
 * `@modelcontextprotocol/sdk` (so the deployed output needs no
 * `node_modules`/`package.json`/`bun install` step at all -- verified: a
 * bundled `mcp/github.ts` runs standalone with zero dependencies nearby).
 * Bundled output keeps a `.ts` extension (Bun happily runs plain JS through
 * a `.ts`-named file) so every existing `bun run .github/.../foo.ts`
 * reference -- in generated workflow YAML, `tools.yaml`, `ScriptRef`'s
 * runtime-path derivation -- needs no change.
 *
 * `.test.ts` files are excluded from entry-point discovery -- tests are a
 * dev-time concern for this repo, not something end users need in their
 * own `.github/`. `dist/.github/` is fully generated output: nothing under
 * it should ever be hand-edited directly.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, MANIFEST_PATH } from "./domain/release-manifest.ts";

/**
 * Packages left out of the bundle and installed on the runner instead.
 *
 * Everything else is inlined, which is what lets the deployed `.github/` run
 * with no `node_modules` beside it. These cannot be: `@huggingface/transformers`
 * reaches `onnxruntime-node`, whose `.node` binaries are not JavaScript and so
 * are not something a JavaScript bundler can carry. Inlining the wrapper and
 * losing the binary produces a script that builds and then fails at its first
 * call, which is the worst of both.
 *
 * Anything added here has to be installed by the runner before an agent starts
 * — see `mcp-packages.json`'s `bun` list and the workflow step that reads it.
 */
const RUNTIME_INSTALLED = ["@huggingface/transformers"];

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "src");
const DIST_GITHUB_DIR = join(REPO_ROOT, "dist", ".github");

/** Recursively collects every entry-point `*.ts` file under `dir`, skipping `excludeDirs` (by name, at any depth) and `*.test.ts` files. */
function collectEntryPoints(dir: string, excludeDirs: ReadonlySet<string>): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      results.push(...collectEntryPoints(join(dir, entry.name), excludeDirs));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/** Bundles every entry point under `srcDir` into `distDir`, preserving its subdirectory structure (e.g. `mcp/github.ts` -> `<distDir>/mcp/github.ts`). */
async function bundleTree(srcDir: string, distDir: string, excludeDirs: ReadonlySet<string> = new Set()): Promise<void> {
  const entrypoints = collectEntryPoints(srcDir, excludeDirs);
  rmSync(distDir, { recursive: true, force: true });

  // Build each deployable entry point independently. Imported implementation
  // modules live under excluded `lib/` directories and are inlined here.
  for (const entrypoint of entrypoints) {
    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir: distDir,
      root: srcDir,
      target: "bun",
      format: "esm",
      naming: "[dir]/[name].ts",
      external: RUNTIME_INSTALLED,
    });
    if (!result.success) {
      console.error(`build-dist: bundling failed for ${entrypoint}:`);
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  }

  console.log(`build-dist: bundled ${entrypoints.length} script(s): ${srcDir} -> ${distDir}`);
}

function copyDirectoryFresh(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
}

function copyStaticAtomaContent(): void {
  const srcAtomaDir = join(SRC_DIR, "atoma");
  const distAtomaDir = join(DIST_GITHUB_DIR, "atoma");

  // Every static file the generated workflows read at runtime must be listed
  // here, or it never reaches `dist/` and so never reaches an adopter. A file
  // missing from this list is invisible in review: it keeps working in whatever
  // `.github/` already has it and is simply absent from everyone else's.
  // `deployment-contract.test.ts` keeps this list in step with `src/atoma/`.
  // README.md is here for the same reason the rest is: an adopter who opens this
  // directory should find out what each path means without leaving it.
  const filesCopiedVerbatim = ["README.md", "config.yaml", "mcp-packages.json", "prompt-template.md"];

  // A file dropped from that list, or renamed, is still sitting in `dist/` from
  // the last build -- `cpSync` adds and never removes. It then ships: the release
  // manifest is built by walking `dist/`, so the orphan is listed as part of the
  // release and unzipped into an adopter's repository. `config.json` became
  // `config.yaml` and both were in the archive until this ran.
  //
  // `tools/` is swept too, and for a sharper reason: `tools.yaml` used to be written
  // there and is not any more. A stale one would keep shipping, and an adopter with a
  // tools file in their tree is an adopter whose runs read it -- the whole defect this
  // change removes, preserved by a build artifact nobody deleted. Only `scripts/`
  // belongs under it now, and `bundleTree` replaced that before this runs.
  //
  // The subdirectories of `atoma/` itself are replaced wholesale below, so files at
  // these two levels are all that can be orphaned.
  const sweep: Array<[string, readonly string[]]> = [
    [distAtomaDir, filesCopiedVerbatim],
    [join(distAtomaDir, "tools"), []],
  ];
  for (const [dir, keep] of sweep) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && !keep.includes(entry.name)) {
        rmSync(join(dir, entry.name));
        console.log(`build-dist: removed ${join(dir, entry.name)}, left over from an earlier build`);
      }
    }
  }

  for (const file of filesCopiedVerbatim) {
    cpSync(join(srcAtomaDir, file), join(distAtomaDir, file));
  }
  copyDirectoryFresh(join(srcAtomaDir, "agent-definitions"), join(distAtomaDir, "agent-definitions"));
  copyDirectoryFresh(join(srcAtomaDir, "skills"), join(distAtomaDir, "skills"));
  // Not read by anything at runtime -- an adopter applies it once with `gh api`.
  // It ships because the required check it names is produced by a workflow that
  // also ships, and a ruleset written by hand against a remembered job name is
  // the failure `generated-workflows.test.ts` exists to prevent.
  copyDirectoryFresh(join(srcAtomaDir, "rulesets"), join(distAtomaDir, "rulesets"));
  // The tools file is NOT built here and does NOT ship. `write_tools_file.ts` writes
  // it per run, from the config, into the runner's temp directory.
  //
  // It used to be generated here and put in the release, which meant an adopter
  // received a config and a file generated from it, with nothing on their side able
  // to regenerate one from the other -- so editing `tools.servers` did nothing, or,
  // if they added a server, blocked every run. A generated file that is distributed
  // is a second source of truth wearing the clothes of a first.
  //
  // The collision check that lived here went with it: a name is only reserved at the
  // moment the file is written, and that moment is now in the adopter's run, where
  // this build cannot see it.

  console.log(`build-dist: copied static content: ${srcAtomaDir} -> ${distAtomaDir}`);
}

/**
 * Write what this release is and what it contains.
 *
 * Last, because it lists what the steps above produced -- including the generated
 * workflows, which `gwf build` wrote before any of this ran. Walking `dist/` rather
 * than assembling a list by hand is the point: a list written by hand is a list that
 * disagrees with the zip the first time somebody adds a file.
 *
 * See `domain/release-manifest.ts` for the two questions this answers.
 */
function writeManifest(): void {
  const version = `v${(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version}`;
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const here = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), here);
      else files.push(here);
    }
  };
  walk(DIST_GITHUB_DIR, ".github");

  const manifest = buildManifest(version, files);
  writeFileSync(join(REPO_ROOT, "dist", MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`build-dist: wrote ${MANIFEST_PATH} for ${version} (${manifest.files.length} files)`);
}

async function main(): Promise<void> {
  await bundleTree(join(SRC_DIR, "scripts"), join(DIST_GITHUB_DIR, "scripts"), new Set(["lib", "testing"]));
  await bundleTree(
    join(SRC_DIR, "atoma", "tools", "scripts"),
    join(DIST_GITHUB_DIR, "atoma", "tools", "scripts"),
    new Set(["lib"]),
  );
  copyStaticAtomaContent();
  writeManifest();
}

void main();



#!/usr/bin/env bun
/**
 * synth-workflows.ts — writes `dist/.github/workflows/*.yml` from this
 * repository's own `src/workflows/`, and from nothing else.
 *
 * ## Why this file exists instead of `gwf build`
 *
 * The `github-actions-workflow-ts` CLI finds its input by globbing the process's
 * working directory: every `*.wac.ts` below `process.cwd()`, recursively, with
 * dotfiles included and only `node_modules` excluded. That pattern is hardcoded
 * in the command; `WacConfig` has no key that narrows it.
 *
 * A checkout is not the only thing under this directory. Agents get a git
 * worktree each, under `.claude/worktrees/`, and every one of them is a full
 * copy of `src/workflows/`. Those copies are on ANOTHER BRANCH. The glob picked
 * them up, all of the copies wrote into the same `dist/.github/workflows/`, and
 * the last one to be written won -- silently, exit 0, valid YAML, with only the
 * file count in the log (`24 workflow file(s)` rather than 8) saying anything at
 * all. `.claude/` is untracked and `dist/` is gitignored, so there is no diff
 * anywhere in which a person could notice. Three agents hit it in one day and
 * each invented a different workaround. See issue #952.
 *
 * `dist/` is the release, and `.github/workflows/` is updated from a release by
 * self-deploy, so the reachable end of that is another branch's workflow running
 * in the live repository.
 *
 * ## Why the discovery is a directory read and not a narrower glob
 *
 * Because the fix has to be "the build reads this tree", not "the build skips
 * those trees". A skip list is a list of the places agents happen to put things
 * today; the next tool that drops a checkout somewhere else is not on it, and
 * the failure it causes is the silent one again. Everything else in this
 * repository already names what is ITS OWN -- `tsconfig.json` lists the source
 * trees, `build-dist.ts` walks the three trees in `BUILT_FROM`, the `test`
 * script names its directories. Workflow generation was the one step that asked
 * the disk.
 *
 * The rest of the generation is the CLI's: its config loader, its output-path
 * resolution, its YAML dump and its header substitution, all through the
 * package's public exports. Only the answer to "which files" is ours.
 *
 * ## What came free with it
 *
 * The source path in each generated file's header is now computed rather than
 * taken from `path.relative(process.cwd(), ...)`, so it reads
 * `src/workflows/atomaton-runner.wac.ts` everywhere. Built on Windows it used to
 * read `src\workflows\atomaton-runner.wac.ts`, which made the deliverable differ
 * by the operating system that happened to build it.
 *
 * And `gwf` is no longer spawned, which is what made `bun run synth` fail on
 * Windows: its launcher runs `node` through a shell without quoting
 * `C:\Program Files\...`. CONTRIBUTING.md carried a two-command workaround for
 * that; it does not need one now.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getConfigAsync,
  importWorkflowFile,
  resolveRootDir,
  writeWorkflowJSONToYamlFiles,
} from "@github-actions-workflow-ts/cli";
import { Context, Diagnostics } from "@github-actions-workflow-ts/lib";

/**
 * The tree the workflow sources live in, repo-relative.
 *
 * This is the whole bound on what the build reads. Everything under it is a
 * workflow source of this repository; nothing outside it is one, whatever the
 * file is called and whichever tool put it there.
 */
export const WORKFLOW_SOURCE_DIR = "src/workflows";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every workflow source of the repository rooted at `repoRoot`, as repo-relative
 * POSIX paths, sorted.
 *
 * Recursive within [`WORKFLOW_SOURCE_DIR`] so that a `.wac.ts` filed in a
 * subdirectory of it is generated rather than quietly ignored -- the bound is
 * the tree, not one directory level.
 *
 * Takes the root as an argument because that is what makes it testable against a
 * fixture tree that has a decoy in it. Reading `REPO_ROOT` directly would leave
 * the one property that matters -- that a sibling checkout is not input --
 * checkable only by putting one on the real disk.
 */
export function workflowSourceFiles(repoRoot: string): string[] {
  const sources: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const here = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), here);
      else if (entry.isFile() && entry.name.endsWith(".wac.ts")) sources.push(here);
    }
  };
  walk(join(repoRoot, ...WORKFLOW_SOURCE_DIR.split("/")), WORKFLOW_SOURCE_DIR);
  return sources.sort();
}

async function main(): Promise<void> {
  // The CLI's config loader reads `wac.config.ts` from the working directory,
  // and its output-directory creation resolves against it too. Set it from this
  // file's own location rather than inheriting whatever the caller had, so that
  // where `bun run synth` is typed from cannot change what it produces.
  process.chdir(REPO_ROOT);

  const config = (await getConfigAsync()) ?? {};
  const rootDir = resolveRootDir(config);

  // Warnings from the action registry (an unverifiable or out-of-range action
  // version) reach a reporter installed here or reach nothing at all -- the
  // emitting side gives up on an optional chain if none is installed. The CLI's
  // own reporter is not part of the package's public exports, so this is the
  // same contract rewritten: honour the configured rules, print the rest.
  Context.__internalSetGlobalContext({
    diagnostics: {
      emit(diagnostic) {
        const severity = Diagnostics.getEffectiveSeverity(diagnostic, config.diagnostics?.rules);
        if (severity === "off") return;
        const stack = diagnostic.stack ? `\n${diagnostic.stack}` : "";
        console.error(`[synth-workflows] ${severity}: ${diagnostic.message} (${diagnostic.code})${stack}`);
      },
    },
    diagnosticRules: config.diagnostics?.rules,
  });

  const sources = workflowSourceFiles(REPO_ROOT);
  if (sources.length === 0) {
    throw new Error(`synth-workflows: no *.wac.ts under ${WORKFLOW_SOURCE_DIR}/ -- nothing to generate`);
  }

  const createdDirectories = new Set<string>();
  let written = 0;
  for (const source of sources) {
    const workflows = await importWorkflowFile(join(REPO_ROOT, source));
    // The repo-relative POSIX path, not a cwd-relative one: it is what the
    // header's `<source-file-path>` is replaced with, and an adopter reading a
    // generated workflow follows it into this repository.
    written += writeWorkflowJSONToYamlFiles(workflows, source, config, rootDir, createdDirectories);
  }

  console.log(`synth-workflows: generated ${written} workflow file(s) from ${sources.length} source(s) in ${WORKFLOW_SOURCE_DIR}/`);
}

if (import.meta.main) await main();

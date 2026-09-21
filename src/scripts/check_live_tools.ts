#!/usr/bin/env bun
/**
 * check_live_tools.ts — start the tool servers this repository's agents would use,
 * and hold what they advertise against the guards its configuration declares.
 *
 * ## What only a running server can answer
 *
 * `atoma validate --with-live-tools` starts the servers an agent definition names
 * and asks each for `tools/list`. Three things come out of that, and nothing that
 * reads a file can answer the first two:
 *
 *   - a `tool_allowlist` / `tool_denylist` pattern matching none of the tools its
 *     server offers — a guard that has stopped guarding
 *   - two `unprefixed: true` servers offering one tool name
 *   - a server that will not start, or will not answer in time
 *
 * A pattern and the tool it names can each be edited, so only running the servers
 * catches both sides. A run already does this at startup and writes what it finds
 * to its log, where nobody reads it; here it decides a check.
 *
 * ## Why this may run on a pull request
 *
 * It starts what the pull request declares, which is executing the change under
 * review. That is what this job is: the commands under `checks.from_pull_request`
 * are the pull request's own, run in its own tree, and no repository secret reaches
 * them. A credential here would be one the change being judged could read, so there
 * is nowhere in that section to name one.
 *
 * The job that holds credentials is `checks.from_default_branch`, whose commands
 * come from the default branch and which receives the pull request as a path to
 * read. Neither job can be given both, which is why this one may start a server at
 * all.
 *
 * Servers are started with no `GH_TOKEN`, since what they are asked for is what they
 * advertise. `GITHUB_REPOSITORY` is left alone: the `github` server refuses to start
 * without it, and it names a repository rather than granting anything.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_DEFINITIONS_DIR,
  CONFIG_FILE,
  MACHINERY_ROOT_VAR,
  SCRIPTS_DIR,
  TOOL_DEFAULTS_FILE,
  TOOLS_DIR,
} from "../domain/machinery/machinery-layout.ts";
import { machineryPath, machineryRoot } from "../lib/machinery.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

/** Exit codes: 0 sound, 1 a finding or a server that would not answer, 2 nothing to check. */
export function main(): void {
  // The tree this repository actually runs from, resolved where every other reader
  // resolves it, so a checkout somewhere else is checked rather than silently
  // skipped. It used to re-implement that rule here, with its own spelling of what
  // an unset variable means.
  const defs = machineryPath(AGENT_DEFINITIONS_DIR);
  if (!existsSync(defs)) {
    console.error(
      `::error::${defs} does not exist, so no agent definition could be checked and a clean pass would mean nothing.`,
    );
    process.exit(2);
  }

  const definitions = readdirSync(defs)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
  if (definitions.length === 0) {
    console.error(`::error::${defs} holds no agent definitions, so nothing was checked.`);
    process.exit(2);
  }

  // Written the way a run writes it, by the writer that ships beside this one. There
  // is no tools file on disk to read: it became a per-run artifact, and one left
  // behind would describe an older build than the tree being checked.
  const work = mkdtempSync(join(tmpdir(), "atomaton-live-tools-"));
  const toolsFile = join(work, "tools.yaml");
  // `SCRIPTS_DIR`, not `${TOOLS_DIR}/../scripts`: the scripts directory is a constant
  // in this layout, and deriving it by walking up from a sibling made two constants
  // agree about their depth for the writer to be found at all.
  //
  // The filename is written out, and deliberately not taken from
  // `write_tools_file.ts`'s own `ref`. That is the obvious improvement and it is
  // wrong: `build-dist.ts` bundles each script, `defineScript` reads
  // `import.meta.url`, and a bundled non-entry module is handed the ENTRY's url — so
  // the imported `ref` resolves to `check_live_tools.ts` and this would spawn itself.
  // Measured in the generated bundle. See `scripts/lib/script-ref.ts`.
  const writer = machineryPath(`${SCRIPTS_DIR}/write_tools_file.ts`);
  const runtimeTools = machineryPath(TOOLS_DIR);
  const wrote = Bun.spawnSync([
    "bun", "run", writer,
    "--config", machineryPath(CONFIG_FILE),
    "--defaults", machineryPath(TOOL_DEFAULTS_FILE),
    "--out", toolsFile,
    "--hook-base", runtimeTools,
  ], { stdout: "inherit", stderr: "inherit" });
  if (wrote.exitCode !== 0) {
    console.error("::error::the tools file could not be written, so no server could be started.");
    process.exit(1);
  }

  // Installed to /usr/local/bin by the workflow step above this one.
  const atoma = "atoma";
  // Every definition, rather than a chosen one: a server only the orchestrator names
  // is still a server this repository's agents are handed. One failure does not stop
  // the loop, so a single run reports everything that is wrong.
  let failed = 0;
  for (const definition of definitions) {
    console.log(`::group::atoma validate --with-live-tools ${definition}`);
    const { GH_TOKEN: _dropped, ...env } = process.env;
    const result = Bun.spawnSync(
      [atoma, "validate", "--agent-def", `${defs}/${definition}`, "--tools-file", toolsFile, "--with-live-tools"],
      // Set for the child even when nothing set it here. The server command lines
      // `write_tools_file.ts` writes are `bun run ${ATOMATON_MACHINERY_ROOT}/...`, so
      // an unset variable expands to nothing rather than to this tree, and every
      // server fails to start with a path that begins at the filesystem root.
      { stdout: "inherit", stderr: "inherit", env: { ...env, [MACHINERY_ROOT_VAR]: machineryRoot() ?? "." } },
    );
    console.log("::endgroup::");
    if (result.exitCode !== 0) failed += 1;
  }

  if (failed > 0) {
    console.error(
      `::error::${failed} of ${definitions.length} agent definitions have a tool problem a running server reported. ` +
        "A pattern that matches nothing is a guard that has stopped guarding.",
    );
    process.exit(1);
  }
  console.log(`${definitions.length} agent definition(s) checked against their live tool servers.`);
}

if (import.meta.main) main();

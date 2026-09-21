#!/usr/bin/env bun
/**
 * write_tools_file.ts — writes the tools file `atoma --tools-file` reads, from
 * `tools.servers` in config.yaml, immediately before it is needed.
 *
 * ## Why this exists
 *
 * The tools file used to be built once, in this template's `synth`, and shipped
 * inside the release. An adopter therefore received two files that agreed only
 * because they were built together here, and then drifted — because nothing in an
 * adopted repository ever regenerated one from the other.
 *
 * The consequences were asymmetric and both silent. Remove a server from
 * `tools.servers` and nothing happens: the shipped tools file still has it, and the
 * agent still gets it. Add one and the run is blocked: `atoma validate` resolves
 * `mcp_servers` against the tools file, which does not have it. Meanwhile the
 * documentation and the review skill both told people that `tools.servers` was where
 * tool servers are configured.
 *
 * A generated file that is distributed is a second source of truth wearing the
 * clothes of a first. So it is not distributed any more. It is written here, per
 * run, and thrown away with the runner.
 *
 * ## Which config it reads, and why that is the whole security question
 *
 * A tools file names `command` for every server, so whoever writes it chooses what
 * processes the run starts. Generating from a pull request's own `config.yaml` would
 * let any pull request run anything — the "a pull request may not decide its own
 * execution environment" rule, crossed at its widest point.
 *
 * `--config` is therefore given the machinery checkout's config, which
 * `atomaton-runner.yml` takes from the default branch. This script does no fetching and
 * makes no decision about trust: it writes what it is pointed at, and the caller is
 * responsible for pointing it at something a person merged.
 *
 * ## Usage
 *
 *   write_tools_file.ts --config <config.yaml> --out <tools.yaml> --hook-base <dir>
 *
 * `--hook-base` is the directory relative hook paths are written against — the
 * `tools/` directory of the tree the hook scripts live in. See `domain/machinery/tools-file.ts`
 * for why the output carries absolute paths.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { reservedServerNames, toolsFileFrom, type ToolsSection } from "../../domain/machinery/tools-file.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface WriteToolsFileArgs {
  config: string;
  out: string;
  "hook-base": string;
  /** The shipped `tools/defaults.yaml`. Passed rather than derived -- see
   * `domain/machinery/shipped-servers.ts` for the layout the derivation got wrong. */
  defaults: string;
}

export const ref = defineScript<WriteToolsFileArgs>(import.meta.url);

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: { type: "string" },
      out: { type: "string" },
      "hook-base": { type: "string" },
      defaults: { type: "string" },
    },
  });

  if (!values.config || !values.out || !values["hook-base"] || !values.defaults) {
    console.error(
      "usage: write_tools_file.ts --config config.yaml --defaults defaults.yaml --out tools.yaml --hook-base DIR",
    );
    process.exit(2);
  }

  let tools: ToolsSection | undefined;
  try {
    const config = Bun.YAML.parse(readFileSync(values.config, "utf8")) as { tools?: ToolsSection };
    tools = config.tools;
  } catch (error) {
    // Fail loudly. Every server an agent uses is in this file, so a run started
    // without it is a run with no tools -- which looks like a confused agent rather
    // than a broken configuration, and costs somebody an afternoon to tell apart.
    console.error(`::error::${values.config}: could not read the tool servers: ${(error as Error).message}`);
    process.exit(1);
  }

  const collisions = reservedServerNames(tools);
  if (collisions.length > 0) {
    console.error(
      `::error::${values.config}: \`tools.servers\` may not be named ${collisions.join(", ")} — ` +
        "`hooks` is the core's reserved key for the hooks that apply to every server, so a server " +
        "by that name would silently become one.",
    );
    process.exit(1);
  }

  const file = toolsFileFrom(tools, values["hook-base"], values.defaults);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(
    values.out,
    `# Generated from ${values.config} for this run. Not a file to edit or keep.\n` +
      // Indented rather than flow style: this is read by a person exactly once, when
      // something about a server is being diagnosed, and one long line helps nobody.
      Bun.YAML.stringify(file, null, 2).replace(/[ \t]+$/gm, ""),
  );
  console.error(`write_tools_file: ${Object.keys(file).length} entries -> ${values.out}`);
}

if (import.meta.main) main();

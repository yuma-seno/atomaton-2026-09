#!/usr/bin/env bun
/**
 * merge_tool_packages.ts — the packages a run installs: the shipped servers' own,
 * plus whatever a project declared for a server it added.
 *
 * ## Why there are two lists
 *
 * `tools/packages.json` exists for the servers Atomaton ships —
 * `@modelcontextprotocol/server-filesystem` is what `filesystem` runs, and
 * `@huggingface/transformers` is what `search` reranks with. Neither is a project's
 * decision, so neither belongs in the file a project edits.
 *
 * `tools.packages` in `config.yaml` is for the other case: a project adds a server of
 * its own under `tools.servers`, and that server needs something installed. Declaring
 * it beside the server is the only place a reader would look.
 *
 * ## Why they are merged here rather than in the workflow
 *
 * The install step reads one shape. Doing this in bash would mean a second `jq`
 * pipeline that has to agree with the first about what an absent key means, and the
 * cost of disagreeing is a package that is silently not installed — which surfaces
 * much later, as a tool server that will not start.
 *
 * ## Usage
 *
 *   merge_tool_packages.ts --shipped packages.json --config config.yaml --out merged.json
 *
 * A missing or unreadable config is not an error: a project that declares nothing is
 * the ordinary case, and the shipped list alone is the right answer for it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { defineScript } from "./lib/script-ref.ts";

export interface MergeToolPackagesArgs {
  shipped: string;
  config: string;
  out: string;
}

export const ref = defineScript<MergeToolPackagesArgs>(import.meta.url);

/** The three installers a tools file may ask for. */
const ECOSYSTEMS = ["npm", "bun", "pip"] as const;

type PackageLists = Partial<Record<(typeof ECOSYSTEMS)[number], string[]>>;

/**
 * Both lists, per ecosystem, deduplicated and in a stable order.
 *
 * Shipped first, because the servers that depend on them are the ones a failed
 * install breaks most visibly. Deduplicated because a project naming a package Atomaton
 * already installs is asking for it to be there, not for it to be installed twice.
 */
export function mergePackages(shipped: PackageLists, project: PackageLists): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ecosystem of ECOSYSTEMS) {
    const names = [...(shipped[ecosystem] ?? []), ...(project[ecosystem] ?? [])]
      .filter((name) => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
    out[ecosystem] = [...new Set(names)];
  }
  return out;
}

/** `tools.packages` from a config, or nothing. Unreadable reads as nothing. */
function projectPackages(configPath: string): PackageLists {
  if (!existsSync(configPath)) return {};
  try {
    const config = Bun.YAML.parse(readFileSync(configPath, "utf8")) as {
      tools?: { packages?: PackageLists };
    };
    return config.tools?.packages ?? {};
  } catch (error) {
    // A config that will not parse is a real problem, and it is one every other step
    // in the run reports with the file in front of it. Failing here as well would
    // replace that message with this one.
    console.error(`::warning::${configPath} could not be read for \`tools.packages\`: ${(error as Error).message}`);
    return {};
  }
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { shipped: { type: "string" }, config: { type: "string" }, out: { type: "string" } },
  });

  if (!values.shipped || !values.config || !values.out) {
    console.error("usage: merge_tool_packages.ts --shipped packages.json --config config.yaml --out merged.json");
    process.exit(2);
  }

  let shipped: PackageLists;
  try {
    shipped = JSON.parse(readFileSync(values.shipped, "utf8")) as PackageLists;
  } catch (error) {
    // The other direction from the config: this file is the deliverable's own, so a
    // failure here is a broken deliverable rather than a project's mistake.
    console.error(`::error::${values.shipped}: ${(error as Error).message}`);
    process.exit(1);
  }

  const merged = mergePackages(shipped, projectPackages(values.config));
  writeFileSync(values.out, JSON.stringify(merged, null, 2) + "\n");

  const total = Object.values(merged).reduce((n, list) => n + list.length, 0);
  console.error(`merge_tool_packages: ${total} package(s) -> ${values.out}`);
}

if (import.meta.main) main();

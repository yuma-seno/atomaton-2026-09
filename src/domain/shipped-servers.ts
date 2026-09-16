/**
 * shipped-servers.ts — reading the tool servers every run starts with.
 *
 * # Why they are a file rather than a constant
 *
 * They were a constant here for one release, and that was worse in three ways a
 * reader feels. The only way to see what `github`'s `env` actually held was to grep a
 * bundled script, because `src/domain/**` is inlined into whatever imports it — and
 * the same definition ended up inside two of them. Overriding a shipped server in
 * `config.yaml` meant overriding something you could not read. And a TypeScript
 * object literal is a second spelling of a thing the config already spells in YAML.
 *
 * `tools/defaults.yaml` ships instead, in the same schema as `tools.servers`. One
 * shape to learn, one merge to understand, and the thing you are overriding is in
 * front of you.
 *
 * # Why it is safe to ship something editable
 *
 * The rule is not "an adopter must be unable to break this" — they can delete
 * `mcp/github.ts` too. It is that `.github/atoma/` is theirs and everything else is
 * not, which `.github/atoma-runtime/` says by being a different directory. And a
 * broken defaults file is caught: `validate_deliverable.ts` writes the tools file
 * from it on every pull request and hands it to `atoma validate`, so the failure is a
 * red check rather than a dead run.
 *
 * # Why `description` is here at all
 *
 * The config used to show a reader what these are, badly — as
 * `bun run ${ATOMA_MACHINERY_ROOT}/...`, which is how a server starts rather than
 * what it is for. The description now sits beside the definition, which is what YAML
 * was chosen for, and the generator strips it exactly as it strips `settings`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfiguredServer } from "./tools-file.ts";

/** A server as `defaults.yaml` carries it: the core's keys, plus this project's own. */
export interface ShippedServer extends ConfiguredServer {
  /** One line on what it is for. Stripped before the core sees it. */
  description?: string;
}

export interface ToolDefaults {
  watch: Record<string, string[]>;
  servers: Record<string, ShippedServer>;
}

/**
 * Where the defaults are read from.
 *
 * Resolved from this module rather than from the working directory, because the
 * readers run from three places: `bun test` at the repository root, `build-dist`
 * against `src/`, and the bundled `write_tools_file.ts` inside a deployed tree. A
 * relative path would be right for one of them.
 *
 * In a deployed tree the bundle sits at `<runtime>/scripts/` and the file at
 * `<runtime>/tools/`, which is the same `../tools/defaults.yaml` step as from
 * `src/domain/` to `src/atoma-runtime/tools/`. That is a coincidence of two layouts
 * and not a thing to rely on, so `toolDefaultsPath` takes an override.
 */
function defaultPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "atoma-runtime", "tools", "defaults.yaml");
}

let cached: ToolDefaults | undefined;

/**
 * The shipped servers and file-wide hooks.
 *
 * Cached, because the generator asks for them once per server and a run reads the
 * same file every time. `path` is for the callers that know better — the deployed
 * bundle, and a test working against a fixture.
 */
export function toolDefaults(path = defaultPath()): ToolDefaults {
  if (cached) return cached;
  const parsed = Bun.YAML.parse(readFileSync(path, "utf8")) as Partial<ToolDefaults>;
  cached = { watch: parsed.watch ?? {}, servers: parsed.servers ?? {} };
  return cached;
}

/** Forget the cache. For tests that swap the file underneath. */
export function forgetToolDefaults(): void {
  cached = undefined;
}

/** One line per shipped server, for the pages that list them. */
export function whatEachIsFor(defaults = toolDefaults()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, server] of Object.entries(defaults.servers)) {
    if (typeof server.description === "string") out[name] = server.description;
  }
  return out;
}

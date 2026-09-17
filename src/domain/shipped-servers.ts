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
 * `mcp/github.ts` too. It is that `.github/atomaton/` is theirs and everything else is
 * not, which `.github/atomaton-runtime/` says by being a different directory. And a
 * broken defaults file is caught: `validate_deliverable.ts` writes the tools file
 * from it on every pull request and hands it to `atoma validate`, so the failure is a
 * red check rather than a dead run.
 *
 * # Why `description` is here at all
 *
 * The config used to show a reader what these are, badly — as
 * `bun run ${ATOMATON_MACHINERY_ROOT}/...`, which is how a server starts rather than
 * what it is for. The description now sits beside the definition, which is what YAML
 * was chosen for, and the generator strips it exactly as it strips `settings`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_DEFAULTS_FILE } from "./machinery-layout.ts";
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
 * Where the defaults are read from when the caller does not say.
 *
 * Relative to this module, because the readers run from three places: `bun test` at
 * the repository root, `build-dist` against `src/`, and the bundled
 * `write_tools_file.ts` inside a deployed tree. A path relative to the working
 * directory would be right for one of them.
 *
 * **This default is correct in `src/` only.** The earlier version of this comment
 * claimed the two layouts happened to agree -- that `<runtime>/scripts/` to
 * `<runtime>/tools/` was the same step as `src/domain/` to `src/atomaton-runtime/tools/`
 * -- and they do not. Bundling flattens `src/domain/` into the script that imports
 * it, so `import.meta.url` in a deployed tree is the SCRIPT's location, and `..`
 * from `<runtime>/scripts/` is `<runtime>`, which already ends in `atomaton-runtime`.
 * The path came out as `atoma-runtime/atoma-runtime/tools/defaults.yaml` and every
 * agent run died on it.
 *
 * So a caller that knows where it is running passes the path, and
 * `write_tools_file.ts` is given one by the workflow. This default serves the tests
 * and the build, which do run from `src/`.
 */
function defaultPath(): string {
  // `.github/atomaton-runtime/tools/defaults.yaml` deployed is
  // `src/atomaton-runtime/tools/defaults.yaml` here: the same path under a
  // different root. Taken from the constant rather than rebuilt from segments,
  // because a name broken into `join(..., "atomaton-runtime", "tools", ...)` is
  // invisible to a search for the path and survives a rename unchanged.
  const belowRoot = TOOL_DEFAULTS_FILE.slice(TOOL_DEFAULTS_FILE.indexOf("/") + 1);
  return join(dirname(fileURLToPath(import.meta.url)), "..", ...belowRoot.split("/"));
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

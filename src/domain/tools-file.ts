/**
 * tools-file.ts — the tools file the core is handed, written from the one config.
 *
 * `tools.servers` in `config.yaml` is the core's own tools-file format, one level
 * in. This turns it back into the shape `atoma --tools-file` reads: the file-wide
 * `watch` becomes the reserved top-level `hooks` key, each server becomes a
 * top-level entry, and `settings` is removed.
 *
 * ## Why a generator rather than a second file
 *
 * A project configures Atoma; it does not configure the binary Atoma runs. Two
 * files made an adopter answer a question they have no way to answer -- which of
 * these two is mine? -- and the answer was never "both", it was "the boundary is
 * an implementation detail of the thing you adopted".
 *
 * ## Why `settings` is stripped rather than passed through
 *
 * `settings` is the one key this project reserves: the server reads it back through
 * `lib/config.ts`, from the same config file, so it never needs to travel through
 * here. Everything else is passed on untouched, so a key a later core release adds
 * -- `url` and `headers` for a remote server, whatever comes next -- works the day
 * it ships without this file learning it.
 *
 * ## Why the hook paths come out absolute
 *
 * The core resolves a hook path against the directory the tools file is IN
 * (`tool_def.rs`, `base_dir = path.parent()`). That was invisible while the file
 * lived at one fixed path and was shipped beside the scripts it named. It is not
 * invisible now: this file is generated per run, into wherever the caller wants it,
 * and a relative path would follow the output rather than the scripts.
 *
 * So `hookBase` is required, and every hook path is resolved against it here. One
 * rule with no exceptions beats a rule that holds for the output locations somebody
 * thought of. The generated file is a run's ephemeral input, not something a person
 * reads, so the loss of a short relative path costs nothing.
 */
import { isAbsolute, join } from "node:path";

/** A server entry as the config carries it: the core's own keys, plus `settings`. */
export interface ConfiguredServer {
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolsSection {
  watch?: Record<string, unknown>;
  servers?: Record<string, ConfiguredServer>;
}

/**
 * The tools file's content, as a plain object ready to be serialised.
 *
 * Returns the structure rather than the text so the caller chooses the writer and
 * this stays testable without a filesystem. The key order is deliberate: `hooks`
 * first, because it applies to everything below it, then the servers in the order
 * the config declared them.
 */
export function toolsFileFrom(tools: ToolsSection | undefined, hookBase: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (tools?.watch && Object.keys(tools.watch).length > 0) out.hooks = absoluteHooks(tools.watch, hookBase);
  for (const [name, server] of Object.entries(tools?.servers ?? {})) {
    const { settings: _delivery, ...forTheCore } = server;
    if (isRecord(forTheCore.hooks)) forTheCore.hooks = absoluteHooks(forTheCore.hooks, hookBase);
    out[name] = forTheCore;
  }
  return out;
}

/** The two hook keys that name a script. The rest of a `hooks` block is tool patterns. */
const HOOK_SCRIPT_KEYS = ["before_tool", "after_tool"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A hooks block with its script paths resolved against `base`.
 *
 * Only `before_tool` and `after_tool` are touched: `tool_allowlist` and
 * `tool_denylist` hold tool-name globs, and rewriting those as paths would turn a
 * pattern into a filename the core then refuses to find.
 *
 * An already-absolute path is left alone, so an adopter who names one gets what they
 * asked for rather than a path joined onto a path.
 */
function absoluteHooks(hooks: Record<string, unknown>, base: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...hooks };
  for (const key of HOOK_SCRIPT_KEYS) {
    const script = out[key];
    if (typeof script !== "string" || script.length === 0) continue;
    if (isAbsolute(script)) continue;
    // Posix separators: this is written for a Linux runner, and a Windows-style
    // separator would reach the core as part of the filename.
    out[key] = join(base, script).split("\\").join("/");
  }
  return out;
}

/**
 * Names in `tools.servers` that would collide with the core's reserved key.
 *
 * `hooks` at the top level of a tools file is the file-wide hook declaration, not
 * a server. A server called `hooks` would be written into that slot and silently
 * become one -- the config would say a server exists, the core would read a hook
 * configuration, and nothing would report either.
 */
export function reservedServerNames(tools: ToolsSection | undefined): string[] {
  return Object.keys(tools?.servers ?? {}).filter((name) => name === "hooks");
}

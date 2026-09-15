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
 * `atoma` rejects a tools file it cannot parse, and an unknown key inside a
 * server entry is exactly that. `settings` is the one key this project reserves:
 * the server reads it back through `lib/config.ts`, from the same config file, so
 * it never needs to travel through here. Everything else is passed on untouched,
 * so a key a later core release adds -- `url` and `headers` for a remote server,
 * whatever comes next -- works the day it ships without this file learning it.
 */

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
export function toolsFileFrom(tools: ToolsSection | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (tools?.watch && Object.keys(tools.watch).length > 0) out.hooks = tools.watch;
  for (const [name, server] of Object.entries(tools?.servers ?? {})) {
    const { settings: _delivery, ...forTheCore } = server;
    out[name] = forTheCore;
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

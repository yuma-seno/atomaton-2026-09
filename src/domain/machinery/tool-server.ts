/**
 * tool-server.ts — the shape of a tool server, wherever it is declared.
 *
 * Four types and no behaviour. They were split between the two modules that act on
 * them — `shipped-servers.ts`, which reads the ones Atomaton ships, and
 * `tools-file.ts`, which merges those with a project's own and writes what the core
 * is handed — and each needed a type the other owned. So the two imported each
 * other.
 *
 * A cycle between two modules that both make sense is usually this: the shapes and
 * the behaviour are in one file, and the shapes are shared while the behaviour is
 * not. Splitting them apart costs a file and leaves both directions pointing here.
 *
 * The same schema describes a shipped server and a project's own, which is the
 * whole of the override rule: a name Atomaton ships is overridden field by field,
 * a name it does not is added. One shape to learn, and one place to read it.
 */

/** A server entry as the config carries it: the core's own keys, plus `settings`. */
export interface ConfiguredServer {
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The `tools` section of a project's `config.yaml`. */
export interface ToolsSection {
  watch?: Record<string, unknown>;
  servers?: Record<string, ConfiguredServer>;
}

/** A server as `defaults.yaml` carries it: the core's keys, plus this project's own. */
export interface ShippedServer extends ConfiguredServer {
  /** One line on what it is for. Stripped before the core sees it. */
  description?: string;
}

/** Everything `defaults.yaml` declares. */
export interface ToolDefaults {
  watch: Record<string, string[]>;
  servers: Record<string, ShippedServer>;
}

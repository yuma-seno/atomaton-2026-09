import { describe, expect, test } from "bun:test";
import { reservedServerNames, toolsFileFrom } from "./tools-file.ts";
import { toolDefaults } from "./shipped-servers.ts";

/** The `tools/` directory relative hook paths are written against. */
const HOOK_BASE = "/m/.github/atomaton/tools";

/** The file a project that has configured nothing gets. */
const shipped = () => toolsFileFrom(undefined, HOOK_BASE);

/**
 * The generator carries the machinery's own servers now, and a project's config is
 * additive. These pin what that means, in both directions: what a project cannot
 * lose, and what it can still say.
 */
describe("what every run starts with", () => {
  test("the shipped servers are there with no config at all", () => {
    const out = shipped();
    for (const name of Object.keys(toolDefaults().servers)) {
      expect(out[name], `${name} must be in every tools file`).toBeDefined();
    }
  });

  /**
   * The reason they moved out of the config: deleting one takes a capability from
   * every agent that named it, and the core aborts the run rather than starting
   * without it. There is no spelling for "remove `shell`" because there does not
   * need to be — an agent that has finished with a server drops it from its own
   * `mcp_servers`, and a server nobody names is never started.
   */
  test("a project cannot remove one by writing an empty servers map", () => {
    const out = toolsFileFrom({ servers: {} }, HOOK_BASE);
    expect(Object.keys(out).filter((k) => k !== "hooks").sort()).toEqual(Object.keys(toolDefaults().servers).sort());
  });

  test("the file-wide hooks are there too", () => {
    const out = shipped();
    for (const key of Object.keys(toolDefaults().watch)) {
      expect((out.hooks as Record<string, unknown>)[key], `hooks.${key}`).toBeDefined();
    }
  });
});

describe("what a project adds", () => {
  test("a name Atoma does not ship is a new server", () => {
    const out = toolsFileFrom({ servers: { warehouse: { command: "bun", args: ["run", "x.ts"] } } }, HOOK_BASE);
    expect(out.warehouse).toEqual({ command: "bun", args: ["run", "x.ts"] });
  });

  /**
   * Field by field, so the smallest change stays the smallest change. Replacing the
   * whole entry would mean a project raising one timeout had to copy an argv it has
   * no reason to know, and would then hold a stale copy of it after an upgrade.
   */
  test("a name Atoma does ship is overridden one field at a time", () => {
    const out = toolsFileFrom({ servers: { shell: { request_timeout_secs: 7200 } } }, HOOK_BASE);
    const entry = out.shell as Record<string, unknown>;
    expect(entry.request_timeout_secs, "what they said").toBe(7200);
    expect(entry.command, "and what they did not").toBe(toolDefaults().servers.shell!.command);
  });

  test("their file-wide hook is appended to the machinery's, not instead of it", () => {
    const out = toolsFileFrom({ watch: { after_tool: "./scripts/hooks/mine.ts" } }, HOOK_BASE);
    const after = (out.hooks as Record<string, string[]>).after_tool!;
    expect(after.length, "both are there").toBe(toolDefaults().watch.after_tool!.length + 1);
    expect(after.at(-1), "theirs runs last").toBe(`${HOOK_BASE}/scripts/hooks/mine.ts`);
  });

  /** One script reads better as a scalar. The core takes both, and so does this. */
  test("a list of their own hooks is accepted as well as one", () => {
    const out = toolsFileFrom({ watch: { after_tool: ["./a.ts", "./b.ts"] } }, HOOK_BASE);
    const after = (out.hooks as Record<string, string[]>).after_tool!;
    expect(after.slice(-2)).toEqual([`${HOOK_BASE}/a.ts`, `${HOOK_BASE}/b.ts`]);
  });

  /**
   * `atoma` would refuse a key it does not know inside a server entry, and `settings`
   * is this project's own: the server reads it back from the config, so it has no
   * reason to travel here.
   */
  test("settings is stripped", () => {
    const out = toolsFileFrom({ servers: { search: { settings: { reranker_model: "m" } } } }, HOOK_BASE);
    expect(JSON.stringify(out.search)).not.toContain("settings");
    expect((out.search as Record<string, unknown>).command, "the rest survives").toBeDefined();
  });

  /**
   * Passed through untouched, so a key a later core release adds -- `url` and
   * `headers` for a remote server, whatever comes next -- works the day it ships
   * without this file learning about it.
   */
  test("keys this file has never heard of are passed through", () => {
    const out = toolsFileFrom({ servers: { remote: { url: "https://example.com/mcp", headers: { A: "b" } } } }, HOOK_BASE);
    expect(out.remote).toEqual({ url: "https://example.com/mcp", headers: { A: "b" } });
  });
});

/**
 * The core resolves a hook path against the directory the tools file is IN, and that
 * directory is now the run's temp directory. A relative path would follow the output
 * rather than the scripts.
 */
describe("hook paths", () => {
  test("the machinery's own come out absolute", () => {
    const after = (shipped().hooks as Record<string, string[]>).after_tool!;
    for (const path of after) expect(path.startsWith(HOOK_BASE), path).toBe(true);
  });

  test("a server's own hook is resolved too", () => {
    const out = toolsFileFrom({ servers: { fs: { command: "x", hooks: { after_tool: "./scripts/hooks/n.ts" } } } }, HOOK_BASE);
    expect((out.fs as { hooks: Record<string, unknown> }).hooks.after_tool).toBe(`${HOOK_BASE}/scripts/hooks/n.ts`);
  });

  /**
   * Tool patterns, not paths. Rewriting one as a path turns a glob into a filename
   * the core then refuses to find.
   */
  test("allow and deny lists are left alone", () => {
    const hooks = { tool_denylist: ["filesystem__directory_tree"], tool_allowlist: ["a__b"] };
    const out = toolsFileFrom({ servers: { fs: { command: "x", hooks } } }, HOOK_BASE);
    expect((out.fs as { hooks: unknown }).hooks).toEqual(hooks);
  });

  test("an absolute path is not joined onto the base", () => {
    const out = toolsFileFrom({ watch: { after_tool: "/opt/mine.ts" } }, HOOK_BASE);
    expect((out.hooks as Record<string, string[]>).after_tool!.at(-1)).toBe("/opt/mine.ts");
  });
});

/**
 * A server called `hooks` would be written into the slot the core reads as the
 * file-wide hook declaration. The config would say a server exists, the core would
 * read a hook configuration, and neither would report the other.
 */
describe("reservedServerNames", () => {
  test("names a server that would collide with the core's reserved key", () => {
    expect(reservedServerNames({ servers: { hooks: { command: "x" } } })).toEqual(["hooks"]);
  });

  test("ordinary names are not reserved", () => {
    expect(reservedServerNames({ servers: { shell: { command: "x" }, github: { command: "y" } } })).toEqual([]);
  });
});

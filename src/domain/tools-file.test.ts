import { describe, expect, test } from "bun:test";
import { reservedServerNames, toolsFileFrom } from "./tools-file.ts";

/**
 * The tools file is written from the one config now, so the shape the core reads
 * is produced rather than maintained. These pin what the generator owes it.
 */
describe("toolsFileFrom", () => {
  test("a server becomes a top-level entry", () => {
    const out = toolsFileFrom({ servers: { shell: { command: "bun", args: ["run", "x.ts"] } } });
    expect(out.shell).toEqual({ command: "bun", args: ["run", "x.ts"] });
  });

  /**
   * `hooks` at the top of a tools file is the file-wide declaration. It is called
   * `watch` in the config so that a section named `hooks` does not sit beside a
   * per-server `hooks` meaning something narrower.
   */
  test("watch becomes the core's reserved hooks key", () => {
    const out = toolsFileFrom({ watch: { after_tool: "./guard.ts" }, servers: {} });
    expect(out.hooks).toEqual({ after_tool: "./guard.ts" });
  });

  test("an empty watch is left out rather than written as an empty map", () => {
    expect(toolsFileFrom({ watch: {}, servers: {} })).toEqual({});
  });

  /**
   * `atoma` refuses a tools file it cannot parse, and an unrecognised key inside a
   * server entry is exactly that. `settings` is this project's own: the server
   * reads it back from the config, so it never needs to travel here.
   */
  test("settings is stripped", () => {
    const out = toolsFileFrom({
      servers: { search: { command: "bun", settings: { reranker_model: "m" } } },
    });
    expect(out.search).toEqual({ command: "bun" });
  });

  /**
   * Everything else is passed on untouched, so a key a later core release adds --
   * `url` and `headers` for a remote server, whatever comes next -- works the day
   * it ships without this file learning about it. Enumerating the keys here would
   * silently drop them.
   */
  test("keys this file has never heard of are passed through", () => {
    const out = toolsFileFrom({
      servers: { remote: { url: "https://example.com/mcp", headers: { A: "b" }, max_output_chars: 100 } },
    });
    expect(out.remote).toEqual({ url: "https://example.com/mcp", headers: { A: "b" }, max_output_chars: 100 });
  });

  test("no servers and no watch is an empty file rather than a crash", () => {
    expect(toolsFileFrom(undefined)).toEqual({});
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

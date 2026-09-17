import { describe, expect, test } from "bun:test";
import { withEditableSource } from "./generated-file-hint.ts";

/**
 * The messages are atoma's, quoted from `infra/persistence/tool_def.rs`. If the core
 * rewords one, the test that matters is the one below it: a message naming the
 * generated file and NOT naming the config is the failure this module exists for.
 */
describe("withEditableSource", () => {
  test("a message naming the generated file says where the source is", () => {
    const out = withEditableSource('Failed to parse tools YAML: ".github/atomaton/tools/tools.yaml"');
    expect(out).toContain("tools.servers");
    expect(out).toContain("config.yaml");
    expect(out, "and says why editing the named file will not work").toContain("rewritten");
  });

  /**
   * The resolved path is relative to the tools file's directory. An adopter wrote
   * `./scripts/hooks/mine.ts` in their config and is shown a path against a directory
   * they never named, with no mention of the file they wrote it in.
   */
  test("a missing hook script says what the path is relative to, and where it is declared", () => {
    const out = withEditableSource(
      "Hook script not found: '.github/atomaton/tools/./scripts/hooks/mine.ts' (resolved from './scripts/hooks/mine.ts')",
    );
    expect(out).toContain(".github/atomaton/tools/");
    expect(out).toContain("tools.servers");
    expect(out, "the file-wide slot is a different key and has to be named").toContain("tools.watch");
  });

  /**
   * The messages that already work are left alone. Every one of these names the server,
   * and a server name is the same word in `tools.servers` — the reader can find it.
   * Adding a hint here would be noise on a message that is doing its job.
   */
  test("a message that names the server is passed through untouched", () => {
    for (const problem of [
      "Tool server 'warehouse' names neither 'command' nor 'url', so there is nothing to connect to.",
      "Tool server 'warehouse' has url 'ftp://x', which is not an http:// or https:// address.",
      "Tool server 'warehouse' declares 'env' but no 'command', so nothing is started.",
      "Tool server 'warehouse' declares 'headers' but no 'url'.",
    ]) {
      expect(withEditableSource(problem), problem).toBe(problem);
    }
  });

  test("an unrelated problem is passed through untouched", () => {
    const problem = "agent-definitions/engineer.md: mcp_servers names 'nope', which no server defines";
    expect(withEditableSource(problem)).toBe(problem);
  });
});

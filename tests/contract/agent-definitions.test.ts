/**
 * agent-definitions.test.ts — consistency between the agent definitions and
 * the tool servers they declare.
 *
 * Atoma resolves every name in an agent's `mcp_servers` against `tools.yaml`
 * and aborts the whole run if one is missing, before a single MCP server
 * starts. That failure is invisible to typecheck, to `synth`, and to any test
 * that exercises one agent at a time.
 *
 * It has already happened once: an agent inspected only its own tool surface,
 * concluded the non-readonly `filesystem` server was unused, and removed it —
 * while `engineer.md` still depended on it for every write operation. Nothing
 * in the pipeline objected, so it merged and broke the engineer.
 *
 * ## This is the dev-time half of a pair
 *
 * The authoritative check is `atoma validate --agent-def X.md --tools-file`, which
 * `atomaton-validate-pr.yml` now runs against every agent definition a pull request
 * would merge — the core's own code, applying the same resolution a run applies.
 *
 * This test stays because it runs where that binary is not: `bun test` on a laptop
 * and in this repository's CI, against `src/` rather than the deployed tree, before
 * anything is generated. It is an approximation of the real rule — a top-level YAML
 * key scan, not a parse — and if the two ever disagree, the core is right.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toolDefaults } from "../../src/domain/machinery/shipped-servers.ts";

const AGENT_DIR = join(process.cwd(), "src/content/agent-definitions");
const CONFIG = join(process.cwd(), "src/content/config.yaml");

/**
 * Every server name a run would resolve: the ones Atomaton ships, plus whatever this
 * project added.
 *
 * Both halves, because both halves are real. It read only `tools.servers` while the
 * eight shipped servers lived there; they are in `domain/machinery/shipped-servers.ts` now, and
 * a config's `servers` holds additions and overrides. Reading either alone would let
 * an agent name something that does not resolve -- which is the whole failure this
 * file exists to catch, and the one the core reports by aborting the run before a
 * single tool starts.
 *
 * Not read from a generated tools file: there is none to read. It is written per run
 * into the runner's temp directory, and checking the generator's output against a
 * definition the generator also produced would be checking it against itself.
 *
 * `hooks` needs no filtering here the way it did when this read a tools file. In the
 * config the servers are inside `tools.servers` and the file-wide declaration is
 * `tools.watch` beside them; a server called `hooks` is caught by
 * `reservedServerNames` when the file is written, which fails loudly.
 */
function declaredServers(): Set<string> {
  const config = Bun.YAML.parse(readFileSync(CONFIG, "utf8")) as {
    tools?: { servers?: Record<string, unknown> };
  };
  return new Set([...Object.keys(toolDefaults().servers), ...Object.keys(config.tools?.servers ?? {})]);
}

/** `mcp_servers` entries from one agent definition's YAML frontmatter. */
function requestedServers(agentFile: string): string[] {
  return requestedServersIn(join(AGENT_DIR, agentFile));
}

/** The same, for a definition at an arbitrary path — the delegate's live elsewhere. */
function requestedServersIn(path: string): string[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const start = lines.indexOf("mcp_servers:");
  if (start === -1) return [];

  const servers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // A comment or a blank line is not the end of the block. It used to be: the
    // loop broke on the first line that was not a list item, so a comment between
    // two entries silently truncated the list — `engineer.md`'s `atomaton_env` and
    // `delegate` were never checked, and a definition whose list began with a
    // comment checked nothing at all. The core parses this as YAML and skips both,
    // so the approximation has to as well.
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    const match = /^\s+-\s+(\S+)\s*$/.exec(line);
    if (!match?.[1]) break; // first non-list, non-comment line ends the block
    servers.push(match[1]);
  }
  return servers;
}

const agentFiles = readdirSync(AGENT_DIR).filter((f) => f.endsWith(".md"));

describe("agent definitions", () => {
  test("the fixture set is non-empty", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
    expect(declaredServers().size).toBeGreaterThan(0);
  });

  test.each(agentFiles)("%s declares only servers that tools.yaml defines", (agentFile) => {
    const available = declaredServers();
    const requested = requestedServers(agentFile);

    expect(requested.length).toBeGreaterThan(0);
    for (const server of requested) {
      expect(
        available.has(server),
        `${agentFile} lists mcp_servers "${server}", which tools.servers does not define. ` +
          `Atoma aborts the run on this. Available: ${[...available].sort().join(", ")}`,
      ).toBe(true);
    }
  });
});

/**
 * The delegate's definitions are NOT agent definitions, and this is the file that
 * says so.
 *
 * `agent-definitions/` is the namespace a PERSON dispatches from. A `.md` file
 * there is four things at once: a `/<name>` a person can type on an issue, an entry
 * in every agent's `{{COLLEAGUES_LIST}}`, a name `extract_directive.ts` accepts as a
 * handoff, and a valid value for `agents.on_config_finding`. A delegate is none of
 * them — it is started by `mcp/delegate.ts` and by nothing else, and it has no
 * `task` argument a person could supply.
 *
 * So they live under the runtime root, beside the server that reads them, and this
 * test is what keeps them there. It is a test rather than a comment because the
 * failure is silent in both directions: a definition moved back would start
 * appearing in colleague lists and as a dispatchable name, and nothing else in the
 * repository would report it.
 */
describe("the delegate's definitions are not in the agent namespace", () => {
  const DELEGATES_DIR = join(process.cwd(), "src/entrypoints/tools/delegates");

  test("no delegate definition is under agent-definitions/", () => {
    const strays = agentFiles.filter((f) => f.startsWith("delegate"));
    expect(
      strays,
      "a delegate definition under agent-definitions/ becomes a /<name> a person can dispatch, " +
        "an entry in every colleague list, and a valid agents.on_config_finding value. " +
        "Move it to src/entrypoints/tools/delegates/.",
    ).toEqual([]);
  });

  test("each delegate definition is beside the tools file its sub-run is handed", () => {
    const defs = readdirSync(DELEGATES_DIR).filter((f) => f.endsWith(".md"));
    expect(defs.length, "the delegate definitions must exist").toBeGreaterThan(0);
    for (const def of defs) {
      const tools = join(DELEGATES_DIR, `${def.replace(/\.md$/, "")}.tools.yaml`);
      expect(
        existsSync(tools),
        `${def} has no ${def.replace(/\.md$/, "")}.tools.yaml beside it. ` +
          "mcp/delegate.ts derives the tools file from the definition's name, so a missing one " +
          "is a sub-run that refuses to start.",
      ).toBe(true);
    }
  });

  test("a delegate's mcp_servers are the servers its tools file declares", () => {
    for (const def of readdirSync(DELEGATES_DIR).filter((f) => f.endsWith(".md"))) {
      const requested = requestedServersIn(join(DELEGATES_DIR, def));
      const tools = Bun.YAML.parse(
        readFileSync(join(DELEGATES_DIR, `${def.replace(/\.md$/, "")}.tools.yaml`), "utf8"),
      ) as { servers?: Record<string, unknown> };
      const declared = Object.keys(tools.servers ?? {});
      expect(
        [...requested].sort(),
        `${def} and its tools file disagree. Atoma resolves the definition's mcp_servers against ` +
          "the tools file the sub-run is handed, and a name in one that is not in the other is a " +
          "server that does not start.",
      ).toEqual([...declared].sort());
    }
  });
});

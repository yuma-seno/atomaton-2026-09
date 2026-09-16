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
 * `atoma-validate-pr.yml` now runs against every agent definition a pull request
 * would merge — the core's own code, applying the same resolution a run applies.
 *
 * This test stays because it runs where that binary is not: `bun test` on a laptop
 * and in this repository's CI, against `src/` rather than the deployed tree, before
 * anything is generated. It is an approximation of the real rule — a top-level YAML
 * key scan, not a parse — and if the two ever disagree, the core is right.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SHIPPED_SERVERS } from "../../src/domain/shipped-servers.ts";

const AGENT_DIR = join(process.cwd(), "src/atoma/agent-definitions");
const CONFIG = join(process.cwd(), "src/atoma/config.yaml");

/**
 * Every server name a run would resolve: the ones Atoma ships, plus whatever this
 * project added.
 *
 * Both halves, because both halves are real. It read only `tools.servers` while the
 * eight shipped servers lived there; they are in `domain/shipped-servers.ts` now, and
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
  return new Set([...Object.keys(SHIPPED_SERVERS), ...Object.keys(config.tools?.servers ?? {})]);
}

/** `mcp_servers` entries from one agent definition's YAML frontmatter. */
function requestedServers(agentFile: string): string[] {
  const lines = readFileSync(join(AGENT_DIR, agentFile), "utf8").split(/\r?\n/);
  const start = lines.indexOf("mcp_servers:");
  if (start === -1) return [];

  const servers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+(\S+)\s*$/.exec(line);
    if (!match?.[1]) break; // first non-list line ends the block
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

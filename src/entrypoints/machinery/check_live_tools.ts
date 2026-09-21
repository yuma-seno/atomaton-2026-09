#!/usr/bin/env bun
/**
 * check_live_tools.ts — start the tool servers this repository's agents would use,
 * and hold what they advertise against the guards its configuration declares.
 *
 * ## What only a running server can answer
 *
 * `atoma validate --with-live-tools` starts the servers an agent definition names
 * and asks each for `tools/list`. Three things come out of that, and nothing that
 * reads a file can answer the first two:
 *
 *   - a `tool_allowlist` / `tool_denylist` pattern matching none of the tools its
 *     server offers — a guard that has stopped guarding
 *   - two `unprefixed: true` servers offering one tool name
 *   - a server that will not start, or will not answer in time
 *
 * A pattern and the tool it names can each be edited, so only running the servers
 * catches both sides. A run already does this at startup and writes what it finds
 * to its log, where nobody reads it; here it decides a check.
 *
 * ## The half a dead pattern cannot reach
 *
 * Every finding above is about a pattern. The worse failures produce no dead
 * pattern at all, so the first phase passes over both of them:
 *
 *   - the list mechanism stops being applied — measured in atoma, where an
 *     `unprefixed` server's name could not be resolved from its tool names and every
 *     hook it declared, allowlist included, was silently skipped. Each pattern still
 *     matched a tool the server had; none was dead; nothing was reported.
 *   - an allowlist entry is deleted, which widens the server and matches nothing to
 *     complain about.
 *
 * What both change is the SET of tools the agent ends up holding, and nothing that
 * reads a pattern can see a set. So the second phase asks for the set itself: one
 * `atoma run` per server in `EXACT_TOOL_SETS`, against a stop-immediately LLM on
 * loopback, reading the tool list out of the request the model receives. That request
 * is what the agent is handed — after the core has applied the allowlist, or failed
 * to — which is the one place either defect is visible.
 *
 * `atoma validate` cannot answer it: it reports findings and never builds the
 * registry that decides what is advertised. A second reading of the allowlist here
 * would answer only whether this file agrees with itself.
 *
 * ## Why this may run on a pull request
 *
 * It starts what the pull request declares, which is executing the change under
 * review. That is what this job is: the commands under `checks.from_pull_request`
 * are the pull request's own, run in its own tree, and no repository secret reaches
 * them. A credential here would be one the change being judged could read, so there
 * is nowhere in that section to name one.
 *
 * The job that holds credentials is `checks.from_default_branch`, whose commands
 * come from the default branch and which receives the pull request as a path to
 * read. Neither job can be given both, which is why this one may start a server at
 * all.
 *
 * Servers are started with no `GH_TOKEN`, since what they are asked for is what they
 * advertise. `GITHUB_REPOSITORY` is left alone: the `github` server refuses to start
 * without it, and it names a repository rather than granting anything.
 *
 * The second phase runs an agent, which sounds like more than the first and is less:
 * the provider is a `Bun.serve` on loopback in this process that answers every
 * request with `finish_reason: stop`, so no model is called, no tool is called, and
 * the run is over in one turn. No credential is involved in either phase, which is
 * what lets both of them run here.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareToolSet, describeMismatch, EXACT_TOOL_SETS } from "../../domain/machinery/effective-tools.ts";
import {
  AGENT_DEFINITIONS_DIR,
  CONFIG_FILE,
  MACHINERY_ROOT_VAR,
  SCRIPTS_DIR,
  TOOL_DEFAULTS_FILE,
  TOOLS_DIR,
} from "../../domain/machinery/machinery-layout.ts";
import { machineryPath, machineryRoot } from "../../adapters/runner/machinery.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

/**
 * A provider that ends the turn without being asked anything.
 *
 * On loopback, on a port the kernel chooses, for as long as one run takes. It exists
 * to make the model's request happen at all: the tool list this phase reads is built
 * by the core when it assembles that request, and there is no other moment at which
 * the set an agent holds exists as data.
 *
 * Every request is answered the same way and the FIRST one's tools are what is kept.
 * A later turn cannot widen the set — the registry is built once, before the first
 * request — and reading the last one instead would only let a run that somehow
 * continued overwrite the answer.
 *
 * A completion is recognised by its `messages`, not by its `tools`, and the
 * difference is the whole point of counting at all: a request carrying no `tools` is
 * a server that registered nothing, which is a finding. A request that is not a
 * completion at all — a probe of the endpoint, a malformed body — is neither, and
 * conflating the two would report "advertises nothing" about a server that was never
 * asked.
 */
function serveStoppingProvider(seen: { tools: string[]; completions: number }) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      let body: { messages?: unknown[]; tools?: { function?: { name?: string } }[] } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        // Not a chat completion. Answered anyway, and counted as nothing.
      }
      if (Array.isArray(body.messages)) {
        if (seen.completions === 0) {
          for (const tool of body.tools ?? []) {
            const name = tool.function?.name;
            if (name) seen.tools.push(name);
          }
        }
        seen.completions += 1;
      }
      return Response.json({
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
}

/**
 * What one server advertises to an agent, as the agent receives it.
 *
 * The stub names ONE server, and that is what makes the answer attributable: every
 * tool in the request is that server's, so nothing has to be keyed on a `server__`
 * prefix — the convention that reads an `unprefixed` server's six tools as zero, and
 * which `probes/tool-servers.ts` has already been caught by once.
 *
 * `--max-runtime-secs` is a ceiling on the loop rather than on a server that will not
 * initialise — atoma's own connection timeout answers that one — but it is what keeps
 * a run that somehow keeps going from spending the job's whole thirty minutes on a
 * question with one answer.
 */
async function advertisedTools(
  atoma: string,
  toolsFile: string,
  work: string,
  server: string,
): Promise<{ tools: string[]; exitCode: number; completions: number }> {
  const definition = join(work, `${server}-only.md`);
  writeFileSync(
    definition,
    [
      "---",
      `name: ${server}-only`,
      "description: Advertises one server's tools and does nothing with them.",
      "provider: openai",
      "model: effective-tool-set-probe",
      "mcp_servers:",
      `  - ${server}`,
      "---",
      "",
      "Say done.",
      "",
    ].join("\n"),
  );
  const prompt = join(work, "prompt.txt");
  writeFileSync(prompt, "Say done.\n");

  const seen = { tools: [] as string[], completions: 0 };
  const provider = serveStoppingProvider(seen);
  try {
    const { GH_TOKEN: _dropped, ...env } = process.env;
    const run = Bun.spawn(
      [
        atoma, "run",
        "--agent-def", definition,
        "--tools-file", toolsFile,
        "--prompt-file", prompt,
        "--max-iterations", "2",
        "--max-runtime-secs", "120",
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...env,
          [MACHINERY_ROOT_VAR]: machineryRoot() ?? ".",
          // Named so the client resolves, valued so nothing real is reachable. The
          // base URL is the whole of the redirection; the key is a string the local
          // server never looks at.
          ATOMA_PROVIDER: "openai",
          OPENAI_API_KEY: "effective-tool-set-probe",
          OPENAI_BASE_URL: `http://127.0.0.1:${provider.port}`,
        },
      },
    );
    const exitCode = await run.exited;
    return { tools: seen.tools, exitCode, completions: seen.completions };
  } finally {
    await provider.stop(true);
  }
}

/**
 * Hold each fixed server to its set, exactly.
 *
 * A server named here and absent from the tools file is a failure rather than a skip.
 * `files_readonly` not existing is not "nothing to check": it is the promise gone,
 * and every agent that named it would have failed to start — which is a thing to be
 * told on the pull request that did it.
 */
async function checkExactToolSets(atoma: string, toolsFile: string, work: string): Promise<number> {
  const declared = Bun.YAML.parse(readFileSync(toolsFile, "utf8")) as Record<string, unknown>;
  let failed = 0;
  for (const expected of EXACT_TOOL_SETS) {
    console.log(`::group::the tools ${expected.server} advertises`);
    try {
      if (!(expected.server in declared)) {
        console.error(
          `::error::${toolsFile} declares no server called '${expected.server}'. ${expected.promise}`,
        );
        failed += 1;
        continue;
      }
      const { tools, exitCode, completions } = await advertisedTools(atoma, toolsFile, work, expected.server);
      if (completions === 0) {
        // Nothing was advertised because nothing was asked. Reporting the empty set
        // as a mismatch would name the wrong defect: the server never came up, or
        // the run never reached a turn.
        console.error(
          `::error::a run naming only '${expected.server}' never reached the model (atoma exited ${exitCode}), ` +
            "so what that server advertises is unknown and this check has not passed.",
        );
        failed += 1;
        continue;
      }
      // The question was answered, so the answer decides. A run that then failed on
      // something after the request -- writing a session, a provider response this
      // stub does not model -- is reported and does not overturn a tool list that has
      // already been read.
      if (exitCode !== 0) {
        console.log(`::warning::the run that asked '${expected.server}' what it offers exited ${exitCode} afterwards.`);
      }
      console.log(`${expected.server} advertised: ${tools.join(", ")}`);
      const mismatch = compareToolSet(expected, tools);
      if (mismatch) {
        console.error(`::error::${describeMismatch(expected, mismatch)}`);
        failed += 1;
      }
    } finally {
      console.log("::endgroup::");
    }
  }
  return failed;
}

/** Exit codes: 0 sound, 1 a finding or a server that would not answer, 2 nothing to check. */
export async function main(): Promise<void> {
  // The tree this repository actually runs from, resolved where every other reader
  // resolves it, so a checkout somewhere else is checked rather than silently
  // skipped. It used to re-implement that rule here, with its own spelling of what
  // an unset variable means.
  const defs = machineryPath(AGENT_DEFINITIONS_DIR);
  if (!existsSync(defs)) {
    console.error(
      `::error::${defs} does not exist, so no agent definition could be checked and a clean pass would mean nothing.`,
    );
    process.exit(2);
  }

  const definitions = readdirSync(defs)
    .filter((entry) => entry.endsWith(".md"))
    .sort();
  if (definitions.length === 0) {
    console.error(`::error::${defs} holds no agent definitions, so nothing was checked.`);
    process.exit(2);
  }

  // Written the way a run writes it, by the writer that ships beside this one. There
  // is no tools file on disk to read: it became a per-run artifact, and one left
  // behind would describe an older build than the tree being checked.
  const work = mkdtempSync(join(tmpdir(), "atomaton-live-tools-"));
  const toolsFile = join(work, "tools.yaml");
  // `SCRIPTS_DIR`, not `${TOOLS_DIR}/../scripts`: the scripts directory is a constant
  // in this layout, and deriving it by walking up from a sibling made two constants
  // agree about their depth for the writer to be found at all.
  //
  // The filename is written out, and deliberately not taken from
  // `write_tools_file.ts`'s own `ref`. That is the obvious improvement and it is
  // wrong: `build-dist.ts` bundles each script, `defineScript` reads
  // `import.meta.url`, and a bundled non-entry module is handed the ENTRY's url — so
  // the imported `ref` resolves to `check_live_tools.ts` and this would spawn itself.
  // Measured in the generated bundle. See `scripts/lib/script-ref.ts`.
  const writer = machineryPath(`${SCRIPTS_DIR}/write_tools_file.ts`);
  const runtimeTools = machineryPath(TOOLS_DIR);
  const wrote = Bun.spawnSync([
    "bun", "run", writer,
    "--config", machineryPath(CONFIG_FILE),
    "--defaults", machineryPath(TOOL_DEFAULTS_FILE),
    "--out", toolsFile,
    "--hook-base", runtimeTools,
  ], { stdout: "inherit", stderr: "inherit" });
  if (wrote.exitCode !== 0) {
    console.error("::error::the tools file could not be written, so no server could be started.");
    process.exit(1);
  }

  // Installed to /usr/local/bin by the workflow step above this one.
  const atoma = "atoma";
  // Every definition, rather than a chosen one: a server only the orchestrator names
  // is still a server this repository's agents are handed. One failure does not stop
  // the loop, so a single run reports everything that is wrong.
  let failed = 0;
  for (const definition of definitions) {
    console.log(`::group::atoma validate --with-live-tools ${definition}`);
    const { GH_TOKEN: _dropped, ...env } = process.env;
    const result = Bun.spawnSync(
      [atoma, "validate", "--agent-def", `${defs}/${definition}`, "--tools-file", toolsFile, "--with-live-tools"],
      // Set for the child even when nothing set it here. The server command lines
      // `write_tools_file.ts` writes are `bun run ${ATOMATON_MACHINERY_ROOT}/...`, so
      // an unset variable expands to nothing rather than to this tree, and every
      // server fails to start with a path that begins at the filesystem root.
      { stdout: "inherit", stderr: "inherit", env: { ...env, [MACHINERY_ROOT_VAR]: machineryRoot() ?? "." } },
    );
    console.log("::endgroup::");
    if (result.exitCode !== 0) failed += 1;
  }

  if (failed > 0) {
    console.error(
      `::error::${failed} of ${definitions.length} agent definitions have a tool problem a running server reported. ` +
        "A pattern that matches nothing is a guard that has stopped guarding.",
    );
    process.exit(1);
  }
  console.log(`${definitions.length} agent definition(s) checked against their live tool servers.`);

  // Second, and not conditional on the first having passed anywhere but here: the
  // phases answer different questions, and a dead pattern already stops the job. What
  // the loop above cannot report is a guard that is not applied at all.
  const wrong = await checkExactToolSets(atoma, toolsFile, work);
  if (wrong > 0) {
    console.error(
      `::error::${wrong} server(s) do not advertise the tools they are supposed to. The allowlist that ` +
        "narrows them is the only thing that does, so this is a capability an agent now has.",
    );
    process.exit(1);
  }
  console.log(`${EXACT_TOOL_SETS.length} server(s) advertise exactly the tools they promise.`);
}

// Awaited rather than fired. `main` became async for the second phase, and an
// unhandled rejection is a different exit code and a different message than the
// `::error::` lines above -- which are what a person reads in the job log.
if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

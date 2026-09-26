/**
 * exact-tool-sets.test.ts — the shipped configuration, held to the sets it is
 * supposed to produce.
 *
 * ## Why this exists beside the live check
 *
 * `check_live_tools.ts` asks a running core what an agent is actually handed, which
 * is the only thing that can see an allowlist that has stopped being applied. It
 * cannot see it *here*, on the pull request that breaks it: that job runs with no
 * `ATOMATON_MACHINERY_ROOT`, so the tree it reads is the checkout's `.github/` — and
 * in THIS repository `.github/` is the last release, put there by the self-deploy
 * workflow. A pull request editing `src/entrypoints/tools/defaults.yaml` is checked
 * live only after it has been deployed.
 *
 * For an adopter that is the right arrangement — their `.github/` is the thing they
 * are changing. For Atomaton it leaves one of the two defects in the issue, a deleted
 * allowlist entry, uncaught until the release that ships it. That gap is closed here,
 * by reading the source file the deliverable is built from.
 *
 * ## The direction of the comparison
 *
 * `EXACT_TOOL_SETS` is the authority and the YAML is what is checked against it —
 * never the reverse. An expectation computed from `tool_allowlist` would move with
 * every edit to `tool_allowlist`, which is precisely the defect: deleting `read` from
 * the list would delete it from the expectation too, and the comparison would pass
 * over a server that had just been widened.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EXACT_TOOL_SETS } from "../../src/domain/machinery/effective-tools.ts";
import { DELEGATES_DIR } from "../../src/domain/machinery/machinery-layout.ts";

interface ShippedServer {
  command?: string;
  args?: string[];
  unprefixed?: boolean;
  hooks?: { tool_allowlist?: string[] };
}

const DEFAULTS = "src/entrypoints/tools/defaults.yaml";
const CHECK = "src/entrypoints/machinery/check_live_tools.ts";

const servers = (
  Bun.YAML.parse(readFileSync(DEFAULTS, "utf8").replaceAll("\r\n", "\n")) as {
    servers?: Record<string, ShippedServer>;
  }
).servers ?? {};

describe("the servers whose tool set is a promise", () => {
  for (const expected of EXACT_TOOL_SETS) {
    describe(expected.server, () => {
      test("is shipped", () => {
        expect(servers[expected.server], `${DEFAULTS} no longer ships ${expected.server}. ${expected.promise}`).toBeDefined();
      });

      /**
       * The allowlist, item for item.
       *
       * Both directions of the comparison are the two defects the live check was
       * opened for, arriving one release earlier: an added entry is a tool the agent
       * gains, a removed entry is the promise narrowing to something the code no
       * longer says out loud.
       */
      test("its tool_allowlist is exactly the set it promises", () => {
        const allowlist = servers[expected.server]?.hooks?.tool_allowlist;
        expect(allowlist, `${expected.server} has no tool_allowlist, which is the only thing that narrows it`).toBeDefined();
        expect(
          [...(allowlist ?? [])].sort(),
          `${DEFAULTS} and effective-tools.ts disagree about what ${expected.server} may offer. ${expected.promise}`,
        ).toEqual([...expected.tools].sort());
      });
    });
  }

  /**
   * The premise the whole of `files_readonly` rests on.
   *
   * It is `mcp/files.ts` — the same program `files` runs, six tools, three of which
   * write. If the two ever stop being the same command, the allowlist stops being
   * the thing that makes one of them safe, and the reasoning in `effective-tools.ts`
   * needs rewriting rather than adjusting.
   */
  test("files_readonly is the same program as files", () => {
    expect(servers.files_readonly?.command).toBe(servers.files?.command as string);
    expect(servers.files_readonly?.args).toEqual(servers.files?.args as string[]);
    // And `unprefixed`, which is the shape atoma's hook dispatch was measured failing
    // on: tool names carry no server prefix, so nothing in a name says which server
    // declared the hooks that apply to it.
    expect(servers.files_readonly?.unprefixed).toBe(true);
  });
});

describe("the live check's expectation", () => {
  /**
   * It reads the table, not the configuration.
   *
   * The saving that destroys this check is one line: take the expected set from the
   * tools file's own `tool_allowlist` instead of from `EXACT_TOOL_SETS`. It looks
   * like removing a duplicate and it makes every comparison tautological — the
   * deleted entry disappears from both sides at once. So the source of the
   * expectation is pinned rather than left to read naturally.
   */
  test("comes from effective-tools.ts and never from the allowlist it is checking", () => {
    const source = readFileSync(CHECK, "utf8").replaceAll("\r\n", "\n");
    expect(source).toContain("EXACT_TOOL_SETS");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join("\n");
    expect(
      code.includes("tool_allowlist"),
      "the expected set must be a second, independent statement of the promise; reading tool_allowlist " +
        "here would make it agree with whatever the allowlist has become",
    ).toBe(false);
  });
});

/**
 * The delegate's paths, held to the one rule that decides whether it starts.
 *
 * `mcp/delegate.ts` resolves `--delegates-dir` and `--tools-file` with
 * `machineryPath()`, which is the single place that reads `ATOMATON_MACHINERY_ROOT`.
 * A value in `defaults.yaml` that already carries the root is therefore prefixed
 * twice — `<root>/<root>/.github/...` — and the server refuses to start, which is
 * what happened on the release that first shipped these two entries.
 *
 * The script path in the same entry is the opposite case and is why this is a test
 * rather than a rule about "no root in defaults.yaml": nothing resolves that one but
 * the shell, so it must carry the root itself.
 */
describe("the delegate entries' paths", () => {
  const DELEGATES = ["delegate", "delegate_readonly"];

  /** The value that follows `flag` in an entry's `args`, or undefined. */
  function argAfter(server: ShippedServer, flag: string): string | undefined {
    const args = server.args ?? [];
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  }

  for (const name of DELEGATES) {
    test(`${name} passes --delegates-dir layout-relative, not root-prefixed`, () => {
      const value = argAfter(servers[name] ?? {}, "--delegates-dir");
      expect(value, `${name} no longer passes --delegates-dir`).toBeDefined();
      expect(
        value,
        `${name}'s --delegates-dir is resolved by machineryPath() in mcp/delegate.ts, so it must be ` +
          `the layout-relative path. A value carrying ATOMATON_MACHINERY_ROOT is prefixed twice and ` +
          `the server will not start.`,
      ).toBe(DELEGATES_DIR);
    });

    test(`${name}'s script path carries the root, because nothing else resolves it`, () => {
      const script = (servers[name]?.args ?? [])[1] ?? "";
      expect(
        script,
        `${name}'s script path is handed to the shell, which does not read ATOMATON_MACHINERY_ROOT; ` +
          `it must carry the root itself.`,
      ).toContain("${ATOMATON_MACHINERY_ROOT:-.}");
    });
  }
});

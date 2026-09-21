/**
 * agent-environment.test.ts — what the runner puts in the agent's environment,
 * and what a project may therefore not declare, are one list.
 *
 * ## The failure this exists for
 *
 * `TOOL_SECRETS.reserved` is what `tools.secrets` may not name, and the reason a
 * name is on it is that the agent's process already means something by it. That
 * made it a hand-written copy of the runner's `AGENT_ENV`, and its own comment
 * said what a hand-written copy does:
 *
 * > it is right until the day something is added to one side.
 *
 * It had been. Twelve names were in `AGENT_ENV` and not reserved — `HOME`, `PATH`,
 * `ATOMATON_MACHINERY_ROOT`, `GITHUB_REPOSITORY`, `BRANCH` and the seven cache
 * directories — added to the runner over time and never mirrored back. The first
 * drift of the same list, `ATOMA_COPILOT_TOKEN`, is what the comment was written
 * about; this is the second.
 *
 * So the names live in `domain/declared-secrets.ts` and the generator reads them.
 * This is the half a constant cannot do on its own: the shell is still written by
 * hand, with its own comments and its `${BRANCH:-}` and its cache paths, so
 * nothing but reading the generated file proves the two still agree.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AGENT_ENV_NAMES, TOOL_SECRETS } from "../../src/domain/declared-secrets.ts";

/** The names the generated step actually passes, in the order it passes them. */
function namesInGeneratedStep(): string[] {
  const yaml = readFileSync("dist/.github/workflows/atomaton-runner.yml", "utf8");
  const start = yaml.indexOf("AGENT_ENV=(");
  expect(start, "the runner builds the agent's environment as `AGENT_ENV`").toBeGreaterThan(-1);
  const handedOver = yaml.indexOf('"${AGENT_ENV[@]}"', start);
  expect(handedOver, "the array is handed to `env` in the same step").toBeGreaterThan(start);

  // The array's own body, and nothing after it: the shell between its `)` and the
  // `sudo` line assigns other things, and counting those would make this test about
  // the step rather than about the agent's environment.
  const body = /AGENT_ENV=\(\r?\n([\s\S]*?)\r?\n\s*\)/.exec(yaml.slice(start, handedOver))?.[1] ?? "";
  expect(body, "the array has entries").not.toBe("");
  const declared = [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]!);

  // Then the loop that appends a base URL and a provider only when they are set —
  // named by a `for name in A B` rather than assigned, and as much a part of what
  // the agent is given as the array is.
  const appended =
    /for name in ([A-Za-z0-9_ ]+); do[\s\S]*?AGENT_ENV\+=/.exec(yaml.slice(start, handedOver))?.[1]?.trim().split(/\s+/) ??
    [];
  return [...declared, ...appended];
}

describe("the agent's environment", () => {
  test("is exactly the list the reserved names are built from", () => {
    expect(new Set(namesInGeneratedStep())).toEqual(new Set(AGENT_ENV_NAMES));
  });

  /**
   * The point of the list. Every name the agent's process already means something
   * by is a name `tools.secrets` must not be able to mean something else by.
   */
  test("every one of them is refused to a project's own declaration", () => {
    const unreserved = AGENT_ENV_NAMES.filter((name) => !TOOL_SECRETS.reserved.has(name));
    expect(unreserved, `these are in the agent's environment and not reserved: ${unreserved.join(", ")}`).toEqual([]);
  });

  /** The twelve that had drifted, named so a revert is a failing test rather than a diff. */
  test("the names that were missing stay reserved", () => {
    for (const name of [
      "HOME",
      "PATH",
      "ATOMATON_MACHINERY_ROOT",
      "GITHUB_REPOSITORY",
      "BRANCH",
      "XDG_CACHE_HOME",
      "CARGO_HOME",
      "npm_config_cache",
    ]) {
      expect(TOOL_SECRETS.reserved.has(name), name).toBe(true);
    }
  });
});

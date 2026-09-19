import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_FILE } from "../domain/machinery-layout.ts";
import { parseGithubOutput, scriptPath } from "./testing/harness.ts";
import { declarationIn } from "./read_secret_names.ts";

/**
 * Run the script against a config file it is handed.
 *
 * Deliberately not `makeConfigDir`: this script must not read
 * `.github/atomaton/config.yaml` from the working directory, and a harness that
 * puts one there would hide a regression that reintroduced it.
 */
function run(config: Record<string, unknown> | null) {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-declared-"));
  const configPath = join(dir, "trusted-config.yaml");
  const outputPath = join(dir, "github_output");
  // YAML, like the file the workflow materialises from the default branch.
  if (config !== null) writeFileSync(configPath, Bun.YAML.stringify(config));
  writeFileSync(outputPath, "");
  try {
    const r = spawnSync(
      "bun",
      ["run", scriptPath("read_secret_names.ts"), "--config", configPath],
      { encoding: "utf8", cwd: dir, env: { ...process.env, GITHUB_OUTPUT: outputPath } },
    );
    return { ...r, outputs: parseGithubOutput(readFileSync(outputPath, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("declarationIn", () => {
  /**
   * `tools.secrets` and nothing else. A check or a deployment names its credentials
   * on the entry that uses them, and those travel in the matrix its planning job
   * published -- not through this step, whose one job is the agent's own process.
   */
  test("reads tools.secrets", () => {
    expect(declarationIn("tools:\n  secrets: [A]\n")).toEqual(["A"]);
  });

  test("an absent section declares nothing", () => {
    expect(declarationIn("{}")).toBeUndefined();
  });

  // Crossing these would put a deployment credential in the agent's own
  // environment, which is the boundary these lists exist to draw.
  test("a deployment's own credentials are not the agent's", () => {
    const config = "tools:\n  secrets: [A]\ndeploy:\n  on_merge:\n    - name: ship\n      secrets: [C]\n";
    expect(declarationIn(config)).toEqual(["A"]);
  });
});

describe("read_secret_names.ts", () => {
  test("publishes the declared names as a JSON array", () => {
    const r = run({ tools: { secrets: ["SLACK_TOKEN", "JIRA_API_TOKEN"] } });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.outputs.names!)).toEqual(["SLACK_TOKEN", "JIRA_API_TOKEN"]);
  });

  // Crossing these would put a deployment credential in the agent's own
  // environment, which is the boundary these lists exist to draw.
  test("a deployment's credentials do not reach the agent", () => {
    const config = {
      tools: { secrets: ["SLACK_TOKEN"] },
      deploy: { on_merge: [{ name: "ship", secrets: ["AWS_ROLE_ARN"], commands: ["x"] }] },
    };
    expect(JSON.parse(run(config).outputs.names!)).toEqual(["SLACK_TOKEN"]);
  });

  // The workflow indexes into this unconditionally, so it has to be valid JSON
  // even when nothing is configured -- which is the common case.
  test("publishes an empty array when nothing is declared", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(JSON.parse(r.outputs.names!)).toEqual([]);
  });

  // The state of a repository that has configured none. Failing every run over
  // it would be worse than the empty answer, which is also the safe one.
  test("a config file that is not there declares nothing, and does not fail", () => {
    const r = run(null);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.outputs.names!)).toEqual([]);
  });

  test("names the declared secrets in the log so a missing one is diagnosable", () => {
    expect(run({ tools: { secrets: ["SLACK_TOKEN"] } }).stderr).toContain("SLACK_TOKEN");
  });

  test("fails the run on an unusable declaration, as a workflow error", () => {
    const r = run({ tools: { secrets: ["GH_TOKEN"] } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error::");
    expect(r.stderr).toContain("GH_TOKEN");
    expect(r.outputs.names).toBeUndefined();
  });

  test("reports every problem rather than only the first", () => {
    const r = run({ tools: { secrets: ["bad name", "GH_TOKEN"] } });
    expect(r.status).toBe(1);
    expect(r.stderr.match(/::error::/g)).toHaveLength(2);
  });

  // Requiring the argument made a deployment break itself: the release that
  // first passed `--config` met the previous release's workflow, which did not.
  // The record of that incident (issue #353) describes the failing run as
  // reading its workflow YAML from the base branch and its scripts from the pull
  // request, which did not reproduce for a `pull_request` event — what holds is
  // the ordering, not the event-specific mechanism.
  //
  // Failing closed instead is safe in the direction that matters -- no argument,
  // no credentials -- and never reaches for the working tree, which is the thing
  // a pull request controls.
  test("declares nothing, loudly, when not told which config to trust", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-declared-"));
    const outputPath = join(dir, "github_output");
    writeFileSync(outputPath, "");
    // A config where the working tree keeps one -- `CONFIG_FILE`, so this stays
    // the path a fallback would actually take -- to catch a fallback that reaches
    // for it: this must be ignored, not used.
    mkdirSync(join(dir, dirname(CONFIG_FILE)), { recursive: true });
    writeFileSync(join(dir, CONFIG_FILE), Bun.YAML.stringify({ tools: { secrets: ["SHOULD_NOT_APPEAR"] } }));
    try {
      const r = spawnSync("bun", ["run", scriptPath("read_secret_names.ts")], {
        encoding: "utf8",
        cwd: dir,
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("::warning::");
      expect(r.stderr).not.toContain("SHOULD_NOT_APPEAR");
      expect(JSON.parse(parseGithubOutput(readFileSync(outputPath, "utf8")).names!)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

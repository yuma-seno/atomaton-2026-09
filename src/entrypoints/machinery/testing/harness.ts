/**
 * harness.ts — shared test helpers for spawning src/entrypoints/machinery/*.ts with a fake
 * `gh` CLI (testing/bin/gh) and/or an isolated config.yaml, so a script that
 * shells out to `gh` or reads `.github/atomaton/config.yaml` can be tested without
 * touching the real GitHub API or this repository's own shared config.
 *
 * Everything here is used from more than one test file. When the scripts' tests
 * lived in a single file these helpers sat at the top of it; splitting that file
 * per script is what moved them here, and what they need to stay is: no test
 * file should define its own way of running a script.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_FILE } from "../../../domain/machinery/machinery-layout.ts";

import { fakeGhEnv } from "./fake-gh-env.ts";

export interface FakeGhRule {
  /** Every one of these substrings must appear in at least one argv element for this rule to match. */
  match: string[];
  stdout?: string;
  code?: number;
}

export interface RunWithFakeGhResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Every `gh` invocation made during the run, in order, as argv arrays. */
  ghCalls: string[][];
}

/**
 * The ambient environment, minus the variables that only exist inside an Atomaton run.
 *
 * A test spawns a child with `...process.env` so it inherits PATH, HOME and the rest
 * of what a program needs. That is right until an agent runs the suite: the runner
 * sets `ATOMATON_RUN_TYPE`, `ISSUE_NUMBER` and `ATOMATON_MACHINERY_ROOT` in the environment
 * the agent works in, and they flow straight into every child a test starts. Seventeen
 * tests failed that way in one run -- `run_checks` reading a machinery root that was
 * not the fixture, a github tool defaulting a number the test meant to leave out --
 * while the same commit passed all 864 in CI, where none of those variables exist.
 *
 * That gap is the real damage. An agent told to work test-first sees a suite that is
 * red for reasons its change did not cause, and it cannot tell which failures are
 * its own. The run that found this spent its remaining iterations hunting one of the
 * phantom failures and never finished the task.
 *
 * Only those variables are removed, and deliberately not `GITHUB_REPOSITORY` or the
 * tokens: those exist in CI too, so they are not the discrepancy, and taking them
 * away would change what CI has been testing all along. A test that wants any of
 * these declares it, and an explicit value still wins -- callers spread their own
 * `env` after this.
 */
export function hermeticEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("ATOMA_") || key.startsWith("ATOMATON_") || key === "ISSUE_NUMBER" || key.startsWith("FAKE_GH_")) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Runs `bun run <scriptAbsPath> ...args` with a fake `gh` on PATH configured
 * by `rules`. Returns the process result plus every `gh` invocation actually
 * made, so tests can assert on exact commands issued, not just the script's
 * own stdout.
 */
export function runWithFakeGh(
  scriptAbsPath: string,
  args: string[] = [],
  opts: { rules?: FakeGhRule[]; env?: Record<string, string>; cwd?: string } = {},
): RunWithFakeGhResult {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-fakegh-"));
  const logPath = join(dir, "gh-calls.jsonl");
  writeFileSync(logPath, "");
  try {
    const r = spawnSync("bun", ["run", scriptAbsPath, ...args], {
      encoding: "utf8",
      cwd: opts.cwd,
      env: {
        ...hermeticEnv(),
        ...opts.env,
        ...fakeGhEnv(dir, opts.rules, logPath),
      },
    });
    const ghCalls = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, ghCalls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Creates a fresh temp directory containing `.github/atomaton/config.yaml`
 * with the given content, for scripts that read config via `adapters/runner/config.ts`
 * (which always resolves that path relative to `cwd`). Caller is
 * responsible for `rmSync(dir, { recursive: true, force: true })`.
 *
 * Callers still pass a plain object; serialising it is this helper's job, so the
 * file's format is decided in one place. It is written as YAML because that is
 * what `loadConfig()` parses -- a test that wrote JSON here would be testing a
 * file the machinery no longer reads. The path comes from `CONFIG_FILE` rather
 * than a literal, so a config that moves again moves the fixtures with it.
 */
export function makeConfigDir(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-config-"));
  mkdirSync(join(dir, dirname(CONFIG_FILE)), { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), Bun.YAML.stringify(config));
  return dir;
}

/**
 * A module path as an `import` in generated source can carry it.
 *
 * A test that writes a temporary `.ts` file importing something from this repository
 * has to put an absolute path inside a string literal, and on Windows that path is
 * full of backslashes — which the TypeScript it is written into reads as escapes.
 * `C:\repos\Atoma\atomaton\src\lib\sibling-check.ts` arrives at the loader as
 * `C:\reposAtomaatomatonsrclibsibling-check.ts`, and the shim fails to resolve a
 * package nobody named.
 *
 * A `file://` URL rather than escaped backslashes: it is what a loader takes on every
 * platform, and it cannot be half-applied the way manual escaping can.
 */
export function importable(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

/**
 * Remove a temporary directory a test made, without failing the test over it.
 *
 * `rmSync(..., { force: true })` is not enough on Windows, where a directory a git
 * process touched stays locked for a moment after that process exits: the removal
 * throws `EBUSY`, from a `finally` block, after every assertion in the test has
 * already passed. `maxRetries` is exactly what Node added for that.
 *
 * And it still swallows what survives the retries. This is a temp directory the
 * operating system will clean up anyway; a test that cannot delete one has not found
 * anything about the code it was testing, and saying it failed would be false.
 */
export function removeTemp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    // The OS owns it now.
  }
}

/** Where the scripts under test live, relative to the repository root. */
export const SCRIPTS_DIR = "src/entrypoints/machinery";

/**
 * The absolute path of a script under test.
 *
 * `runWithFakeGh` wants an absolute path, and every caller was building the
 * same one by hand. Naming it once means a test says which script it is about
 * and nothing else.
 */
export function scriptPath(name: string): string {
  return join(process.cwd(), SCRIPTS_DIR, name);
}

/**
 * Run a script the way the workflows run it: from the deployed tree.
 *
 * Scripts that read config through a cwd-relative path expect cwd to be the
 * repository root of a deployed adoption, which for this repository before
 * anything is copied anywhere is `dist/`. The script path stays absolute so the
 * relative `bun run <script>` argument still resolves from there.
 */
export function runScript(name: string, env: Record<string, string> = {}) {
  return spawnSync("bun", ["run", join(process.cwd(), SCRIPTS_DIR, name)], {
    encoding: "utf8",
    cwd: join(process.cwd(), "dist"),
    env: { ...hermeticEnv(), ...env },
  });
}

/** Parse a `$GITHUB_OUTPUT` file's `key=value` lines into an object. */
export function parseGithubOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

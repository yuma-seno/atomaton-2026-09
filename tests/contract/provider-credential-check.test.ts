/**
 * provider-credential-check.test.ts — the step that refuses a run whose provider
 * has no credential, before the environment is built.
 *
 * ## What it is for
 *
 * Switching provider is ordinary, and forgetting the secret that goes with it is
 * the ordinary way to get it wrong. Nothing noticed until the first inference:
 * after the checkout, the environment setup, the MCP installs and the tool
 * servers. The core's message names the missing credential, but by then a runner
 * is spent and only a person can dispatch the run again.
 *
 * ## What is pinned here, and what is not
 *
 * The core answers the question — provider resolution, the "exactly one
 * credential" rule for auto-detection, and the provider's credential name are all
 * its, and this deliverable keeps no copy of any of them. What belongs to this
 * repository is the ARRANGEMENT: where the step runs, that no secret's VALUE
 * reaches it, which names it asks about, and what each exit code means. Those are
 * what these tests drive.
 *
 * The generated YAML is the input, not the `.wac.ts`, because the generated file
 * is what an adopter receives and what actually runs. Its `run:` block is executed
 * with a stub `atoma` on PATH, so the cases that matter — a credential missing, an
 * ambiguous auto-detection, a binary too old to know the flag, a definition that
 * does not parse — are exercised without depending on which core is installed.
 * `tests/e2e/provider-credential-check.e2e.test.ts` runs the same step against the
 * real binary when one is available.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { RUN_CREDENTIALS } from "../../src/domain/declared-secrets.ts";
import { hermeticEnv } from "../../src/scripts/testing/harness.ts";

const WORKFLOW = "dist/.github/workflows/atomaton-runner.yml";
const CHECK_STEP = "Check the resolved provider has a credential";
const SETUP_STEP = "Run configured environment setup";
const INSTALL_STEP = "Install Atoma CLI";

/** The credentials the step asks about: every provider credential, and not GH_TOKEN. */
const ASKED = RUN_CREDENTIALS.filter((name) => name !== "GH_TOKEN");

interface WorkflowStep {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
}
interface WorkflowDocument {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

function steps(): WorkflowStep[] {
  const doc = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as WorkflowDocument;
  const list = doc.jobs?.run?.steps ?? [];
  expect(list.length, `${WORKFLOW} has no steps`).toBeGreaterThan(0);
  return list;
}

function stepNamed(name: string): WorkflowStep {
  const found = steps().find((step) => step.name === name);
  expect(found, `${WORKFLOW} has no step named "${name}"`).toBeDefined();
  return found!;
}

/**
 * The stubbed `atoma`, whose answer is chosen by the environment.
 *
 * It also records the argv it was given, so a test can assert what this repository
 * ASKED rather than only what it concluded.
 */
function writeStubAtoma(dir: string): void {
  writeFileSync(
    join(dir, "atoma"),
    `#!/usr/bin/env bash
# One line per invocation, each argument in brackets so an EMPTY argument is
# visible: \`--credentials-present ""\` is the step saying "none are set", and
# "never passed the flag at all" is the different question the core treats as
# "do not check".
printf '[%s]' "$@" >> "$STUB_LOG"
printf '\\n' >> "$STUB_LOG"
printf 'ATOMA_PROVIDER=%s\\n' "\${ATOMA_PROVIDER-<unset>}" >> "$STUB_LOG"
if [ "\${STUB_MODE:-ok}" = "unknown-flag" ]; then
  echo "error: unexpected argument '--credentials-present' found" >&2
  exit 2
fi
# Two different questions reach this binary. The one WITH --credentials-present is
# the credential check, and STUB_MODE decides its answer. The one without it is the
# plain validation the step falls back to, where a definition that is well formed
# simply passes -- that is what tells "no credential" apart from "bad file".
case "$*" in
  *--credentials-present*)
    case "\${STUB_MODE:-ok}" in
      ok)
        echo "✓ Agent definition parsed: stub"
        echo "Validation passed."
        exit 0;;
      missing)
        echo "✓ Agent definition parsed: stub"
        echo "Validation passed."
        echo "Error: OPENAI_API_KEY is not set, and the openai provider authenticates with it. Set it, or choose another provider with ATOMA_PROVIDER (one of: openai, ...)" >&2
        exit 1;;
      ambiguous)
        echo "✓ Agent definition parsed: stub"
        echo "Validation passed."
        echo "Error: More than one provider credential is set (OPENAI_API_KEY, OPENROUTER_API_KEY), so which one to use is not decided by the credentials. Name the provider with ATOMA_PROVIDER or the agent definition's provider field, or remove the credentials this run should not use." >&2
        exit 1;;
      none)
        echo "✓ Agent definition parsed: stub"
        echo "Validation passed."
        echo "Error: No provider credential is set. Set one of ANTHROPIC_API_KEY, ATOMA_COPILOT_TOKEN, OPENAI_API_KEY, OPENROUTER_API_KEY, ORCAROUTER_API_KEY, or name a provider with ATOMA_PROVIDER (one of: openai, ...)." >&2
        exit 1;;
      bad-definition)
        echo "Validation failed with 1 error(s):" >&2
        echo "  ✗ Agent definition parse error: Failed to read agent definition: agent.md" >&2
        exit 1;;
    esac
    echo "unexpected STUB_MODE \${STUB_MODE}" >&2
    exit 9;;
  *)
    case "\${STUB_MODE:-ok}" in
      bad-definition)
        echo "Validation failed with 1 error(s):" >&2
        echo "  ✗ Agent definition parse error: Failed to read agent definition: agent.md" >&2
        exit 1;;
      *)
        echo "Validation passed."
        exit 0;;
    esac;;
esac
`,
    { mode: 0o755 },
  );
}

interface StepResult {
  status: number;
  stdout: string;
  stderr: string;
  /** One entry per `atoma` invocation the step made, its argv with brackets around each element. */
  invocations: string[];
  /** What `ATOMA_PROVIDER` held at each invocation, as the binary itself saw it. */
  providerValues: string[];
}

/**
 * Run the step's own bash with a stub `atoma` first on PATH.
 *
 * `present` names the credentials that exist; every other one is answered `false`,
 * which is what GitHub does for a secret the repository does not have.
 */
function runStep(
  opts: { present?: string[]; mode?: string; providerVariable?: string; withAtoma?: boolean } = {},
): StepResult {
  const dir = mkdtempSync(join(tmpdir(), "atomaton-credcheck-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "argv.log");
  writeFileSync(log, "");
  if (opts.withAtoma !== false) writeStubAtoma(bin);

  // The definition the step reads, so the path it builds exists; the stub never
  // parses it, and the real binary's case lives in the e2e test.
  const machinery = join(dir, "machinery");
  mkdirSync(join(machinery, ".github/atomaton/agent-definitions"), { recursive: true });
  writeFileSync(join(machinery, ".github/atomaton/agent-definitions/engineer.md"), "---\nname: engineer\n---\n");

  const present = new Set(opts.present ?? []);
  const env: Record<string, string> = {
    ...hermeticEnv(),
    // The stub first, so what the step asks is observable. With no stub, the ambient
    // PATH alone -- which has no `atoma` on it, because the CLI is installed into a
    // directory a workflow adds, so "there is no atoma to ask" is a state this can
    // produce simply by leaving the stub out.
    //
    // It used to substitute `/usr/bin:/bin` for that case, and both halves were
    // POSIX-only: the separator is `;` on Windows, and neither directory exists there.
    // The step's own `bash` then could not be resolved at all, and the test failed on
    // the shell rather than on anything it was about.
    PATH: opts.withAtoma === false ? (process.env.PATH ?? "") : `${bin}${delimiter}${process.env.PATH ?? ""}`,
    STUB_MODE: opts.mode ?? "ok",
    STUB_LOG: log,
    AGENT: "engineer",
    ATOMATON_MACHINERY_ROOT: machinery,
    ATOMA_PROVIDER_IN: opts.providerVariable ?? "",
    ...Object.fromEntries(ASKED.map((name) => [`${name}_PRESENT`, present.has(name) ? "true" : "false"])),
  };

  try {
    // The flags GitHub's own `shell: bash` uses: `bash --noprofile --norc -eo
    // pipefail {0}`. `-e` and `pipefail` are not decoration here — a step written
    // against a bare `bash -c` can be green in this file and fail on a runner.
    const result = Bun.spawnSync({
      cmd: ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", stepNamed(CHECK_STEP).run ?? ""],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const logLines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return {
      status: result.exitCode ?? -1,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      invocations: logLines.filter((line) => line.startsWith("[")),
      providerValues: logLines
        .filter((line) => line.startsWith("ATOMA_PROVIDER="))
        .map((line) => line.slice("ATOMA_PROVIDER=".length)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the provider credential check", () => {
  test("runs before the environment is built, and after the CLI it asks", () => {
    const names = steps().map((step) => step.name ?? "");
    const check = names.indexOf(CHECK_STEP);
    const setup = names.indexOf(SETUP_STEP);
    const install = names.indexOf(INSTALL_STEP);

    expect(install, `${WORKFLOW} no longer installs the Atoma CLI`).toBeGreaterThanOrEqual(0);
    expect(setup, `${WORKFLOW} no longer runs the environment setup`).toBeGreaterThanOrEqual(0);
    // The order is the whole point: the environment is the cost being saved, and
    // the CLI is the thing that answers. Reordering either silently restores the
    // bug this exists to prevent.
    expect(install, "the credential check asks a binary that must already be installed").toBeLessThan(check);
    expect(check, "the credential check must run before the environment is built").toBeLessThan(setup);
  });

  // The step can see which credentials EXIST without holding any of them, and this
  // is what makes that true. `${{ secrets.NAME }}` here would put a value in a
  // shell, in that shell's log, and in /proc for the step's lifetime.
  test("asks about presence, never about value", () => {
    const env = stepNamed(CHECK_STEP).env ?? {};
    for (const name of ASKED) {
      expect(Object.keys(env), `${name} is asked about and not supplied`).toContain(`${name}_PRESENT`);
      expect(
        env[`${name}_PRESENT`],
        `${name}_PRESENT must be the boolean GitHub computes, not the secret`,
      ).toBe(`\${{ secrets.${name} != '' }}`);
    }
    // Nothing in this step's env may be a bare secret reference: `secrets.X != ''`
    // is a boolean, `secrets.X` is a value.
    for (const [name, value] of Object.entries(env)) {
      if (!value.includes("secrets.")) continue;
      expect(
        /!=\s*''/.test(value),
        `${name} in the check step's env would put a secret's value in the shell`,
      ).toBe(true);
    }
    // GH_TOKEN is the run's own token rather than a repository secret, so
    // `secrets.GH_TOKEN != ''` would answer "absent" about a token that exists.
    expect(Object.keys(env)).not.toContain("GH_TOKEN_PRESENT");
  });

  test("carries no `if:`, because the gate it would use is not computed yet", () => {
    // The obvious gate is the one "Run agent" carries, `new_event_count != 0`, and
    // it is the wrong one HERE: that output comes from "Merge GitHub context into
    // session", which runs after environment setup -- so a step before the setup
    // reads it as the empty string, and `'' != '0'` is TRUE. The condition would
    // look like a gate and be a constant.
    const check = stepNamed(CHECK_STEP);
    expect(
      check.if,
      `${CHECK_STEP} is placed before the environment setup, so anything it reads from a later step is the empty string`,
    ).toBeUndefined();

    const names = steps().map((step) => step.name ?? "");
    const context = names.indexOf("Merge GitHub context into session");
    expect(context, "the step that produces new_event_count").toBeGreaterThanOrEqual(0);
    expect(
      context,
      "if this ever moves before the check, the no-op gate becomes expressible and this test should be rewritten",
    ).toBeGreaterThan(names.indexOf(CHECK_STEP));
    // And what the agent's own gate reads, so the two tests fail together if it moves.
    expect(stepNamed("Run agent").if).toContain("new_event_count");
  });

  test("names the credentials that exist, and asks about nothing else", () => {
    const result = runStep({ present: ["OPENROUTER_API_KEY", "ORCAROUTER_API_KEY"] });
    expect(result.status).toBe(0);
    const asked = result.invocations.join(" ");
    expect(asked, "the step must ask atoma about the credentials that exist").toContain(
      "[--credentials-present][OPENROUTER_API_KEY,ORCAROUTER_API_KEY]",
    );

    // And with none set, the flag is still passed, with an empty value: an absent
    // flag means "do not check", which is the opposite question, and it is the
    // populated message that names every credential that would work.
    const none = runStep({ present: [], mode: "none" });
    expect(none.status).toBe(1);
    expect(none.invocations.join(" ")).toContain("--credentials-present][]");
    expect(none.stdout).toContain("::error::");
    // Every name in one message is not one missing name. Picking one would send
    // somebody to create a secret that may not be the one they need.
    expect(none.stdout).not.toContain("authenticates with");
  });

  test("passes ATOMA_PROVIDER through, promoted only when it is set", () => {
    // The step and the agent must resolve the same provider. An empty
    // ATOMA_PROVIDER reaching the core would defeat auto-detection entirely, so the
    // `_IN` form is promoted only when non-empty — and the stub records what the
    // core was actually given, which is what makes that checkable.
    const withVariable = runStep({ providerVariable: "openai" });
    expect(withVariable.status).toBe(0);
    expect(withVariable.providerValues).toContain("openai");

    const without = runStep({ providerVariable: "" });
    expect(without.status).toBe(0);
    expect(
      without.providerValues,
      "an unset repository variable must reach the core unset, not empty",
    ).toContain("<unset>");
  });

  test("says nothing when the provider's credential is there", () => {
    const result = runStep({ present: ["ORCAROUTER_API_KEY"] });
    expect(result.status).toBe(0);
    // The core also prints its ordinary validation lines on this path. A run that
    // is fine must not grow a log block per run for a check that found nothing.
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("stops, names the missing secret, and says nothing was built", () => {
    const result = runStep({ mode: "missing" });
    expect(result.status, "a missing credential must fail the step").toBe(1);
    expect(result.stdout).toContain("::error::");
    expect(result.stdout, "the name to add must be in the annotation, not only the log").toContain(
      "OPENAI_API_KEY",
    );
    expect(result.stdout).toContain("before the environment was built");
  });

  test("stops on an undecidable auto-detection without inventing a missing secret", () => {
    const result = runStep({ mode: "ambiguous" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::");
    expect(
      result.stdout,
      "two credentials set is not one missing credential; naming one would be wrong",
    ).not.toMatch(/authenticates with (OPENAI|OPENROUTER|ORCAROUTER)_API_KEY/);
  });

  /**
   * "I could not ask" is not "there is no credential".
   *
   * Both of these are the check being unavailable rather than the answer being
   * "missing", and stopping a healthy run on that difference costs more than the
   * delay this saves. The core still refuses at the first inference, where the
   * message is its own.
   */
  test("warns and continues when the binary does not know the flag", () => {
    const result = runStep({ mode: "unknown-flag" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
    expect(result.stdout).toContain("could not ask atoma");
  });

  test("warns and continues when there is no binary to ask", () => {
    const result = runStep({ withAtoma: false });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
  });

  test("does not report a broken definition as a missing secret", () => {
    // The same exit code covers both, and only the core can tell them apart. Sending
    // somebody to add a secret that changes nothing is worse than saying nothing.
    const result = runStep({ mode: "bad-definition" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::");
    expect(result.stdout).toContain("does not validate");
    expect(result.stdout).not.toContain("::error::");
  });
});

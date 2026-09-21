/**
 * provider-credential-check.e2e.test.ts — the credential step, against the REAL
 * `atoma` binary.
 *
 * `tests/contract/provider-credential-check.test.ts` drives the step's bash with a
 * stub, which is where every branch can be reached. What a stub cannot tell is
 * whether the question this repository asks is one the core still answers: the step
 * deliberately degrades to a warning when the binary does not understand
 * `--credentials-present`, so a rename or a removal upstream would leave the check
 * silently doing nothing — a green run, and no failing test anywhere.
 *
 * So this runs the same step with the real binary and the REAL agent definitions,
 * and asserts both halves of the acceptance criterion: a missing credential stops
 * the run and names the secret to add, and a present one lets the run continue in
 * silence.
 *
 * Skipped when no binary is found, like the other e2e suites — `bun run test`, which
 * CI runs, does not include `tests/e2e`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_CREDENTIALS } from "../../src/domain/delivery/declared-secrets.ts";
import { AGENT_DEFINITIONS_DIR } from "../../src/domain/machinery/machinery-layout.ts";
import { hermeticEnv } from "../../src/entrypoints/machinery/testing/harness.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_STEP = "Check the resolved provider has a credential";

/**
 * The binary to ask: an explicit override, the sibling checkout the other e2e
 * suites use, or whatever a runner has installed.
 */
function findAtoma(): string | undefined {
  return [
    process.env.ATOMA_BIN,
    join(REPO_ROOT, "..", "atoma/target/debug/atoma"),
    "/usr/local/bin/atoma",
  ]
    .filter((path): path is string => Boolean(path))
    .find(existsSync);
}

const ATOMA = findAtoma();

describe.skipIf(ATOMA === undefined)("provider credential check against the real atoma", () => {
  /**
   * Run the generated step's own bash, with the repository's real machinery.
   *
   * The agent definitions come from `src/content/agent-definitions` — the source the
   * deliverable ships — so this reads the `provider:` those definitions actually
   * declare rather than a fixture.
   */
  function runCheck(credentialsPresent: string[]) {
    const workflow = join(REPO_ROOT, "dist/.github/workflows/atomaton-runner.yml");
    expect(existsSync(workflow), "run `bun run synth` first").toBe(true);
    const doc = Bun.YAML.parse(readFileSync(workflow, "utf8")) as {
      jobs?: { run?: { steps?: { name?: string; run?: string }[] } };
    };
    const step = doc.jobs?.run?.steps?.find((candidate) => candidate.name === CHECK_STEP);
    expect(step?.run, "the generated workflow no longer has the credential check").toBeDefined();

    const dir = mkdtempSync(join(tmpdir(), "atomaton-credcheck-e2e-"));
    const machinery = join(dir, "machinery");
    // The step reads its definition from the machinery root, which on a runner is a
    // checkout of the default branch. Here that is the shipped source, so what is
    // checked is what an adopter receives.
    const stage = `mkdir -p "${machinery}/${AGENT_DEFINITIONS_DIR}" && cp "${REPO_ROOT}/src/content/agent-definitions/"*.md "${machinery}/${AGENT_DEFINITIONS_DIR}/"`;
    try {
      const result = Bun.spawnSync({
        // The flags GitHub's own `shell: bash` runs: `bash --noprofile --norc -eo pipefail {0}`.
        cmd: ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", `${stage}\n${step!.run}`],
        env: {
          ...hermeticEnv(),
          PATH: `${dirname(ATOMA!)}:${process.env.PATH ?? ""}`,
          AGENT: "engineer",
          ATOMATON_MACHINERY_ROOT: machinery,
          ATOMA_PROVIDER_IN: "",
          // The same list the step asks about, from the one place that decides it.
          ...Object.fromEntries(
            RUN_CREDENTIALS.map((name) => [
              `${name}_PRESENT`,
              credentialsPresent.includes(name) ? "true" : "false",
            ]),
          ),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        status: result.exitCode ?? -1,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The credential the shipped definitions need, as the CORE names it.
   *
   * Read from the core's own refusal rather than from a table here, which is the
   * point of asking it at all: if the definition changes provider, or the core
   * changes how it reports the missing credential, this test says so instead of
   * quietly agreeing with a copy that has drifted.
   */
  function credentialTheShippedProviderNeeds(): string {
    const definition = readFileSync(join(REPO_ROOT, AGENT_DEFINITIONS_DIR, "engineer.md"), "utf8");
    const provider = /^provider:\s*(\S+)\s*$/m.exec(definition)?.[1];
    expect(provider, "the shipped engineer definition names no provider").toBeDefined();

    const absent = runCheck([]);
    const named = /Error: (\S+) is not set, and the \S+ provider authenticates with it/.exec(
      `${absent.stdout}${absent.stderr}`,
    )?.[1];
    expect(
      named,
      `the real binary did not name the credential for provider '${provider}'. Either the ` +
        `definition changed or the core stopped reporting this, which is the case this test ` +
        `exists to catch:\n${absent.stdout}${absent.stderr}`,
    ).toBeDefined();
    return named!;
  }

  test("the binary understands --credentials-present", () => {
    // Without this, every case below passes through the step's own "I could not ask"
    // branch and proves nothing at all — which is exactly the silent failure this
    // file exists to prevent.
    const result = runCheck([]);
    expect(result.stdout, "the step fell back to a warning, so this binary does not know the flag").not.toContain(
      "could not ask atoma",
    );
    expect(result.stdout, "the step fell back to a warning").not.toContain("does not validate");
  });

  test("stops and names the secret to add when the provider's credential is absent", () => {
    const credential = credentialTheShippedProviderNeeds();
    const result = runCheck([]);

    expect(result.status, "a run with no provider credential must not continue").toBe(1);
    expect(result.stdout, "the name to add must be in the annotation, which is the run summary").toContain(
      `::error::this run's provider authenticates with ${credential}`,
    );
    expect(result.stdout).toContain("before the environment was built");
  });

  test("continues in silence when the provider's credential is there", () => {
    const credential = credentialTheShippedProviderNeeds();
    const result = runCheck([credential]);

    expect(result.status).toBe(0);
    // The core also prints its ordinary validation lines on this path; a healthy run
    // must not grow a log block for a check that found nothing.
    expect(result.stdout, "a satisfied check must say nothing").toBe("");
    expect(result.stderr).toBe("");
  });
});

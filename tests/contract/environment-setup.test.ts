/**
 * Every job that runs a project's own commands sets that project's environment up
 * first.
 *
 * The failure this prevents is not a broken build. It is a build that passes for
 * the agent and fails in CI, on a machine the agent cannot see, which comes back
 * to an engineer as a defect that does not reproduce -- and `CI_RETRY_LIMIT`
 * spends three inferences on it before a human hears about it.
 *
 * Pinned against the generated YAML rather than the `.wac.ts`, because the
 * generated file is what an adopter receives and what actually runs. A fourth job
 * that runs project commands should fail this test until it includes the step.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SETUP_STEP = "Run configured environment setup";

/** The three jobs, and the step in each that runs what the project declared. */
const JOBS = [
  {
    workflow: "atomaton-runner",
    job: "run",
    projectCommands: "Run agent",
    why: "the agent's own shell, which is the environment every other one is compared against",
  },
  {
    workflow: "atomaton-check",
    // The job that runs the project's commands, which is no longer the one a ruleset
    // names: that name moved to the job which only collects the verdicts.
    job: "pull-request-checks",
    projectCommands: "Run the configured checks",
    why: "the verdict a pull request merges on",
  },
  {
    workflow: "atomaton-deploy",
    job: "deploy",
    projectCommands: "Deploy the targets this run is for",
    why: "the least frequent and the most expensive to get wrong",
  },
] as const;

interface WorkflowDocument {
  jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>;
}

function stepNames(workflow: string, job: string): string[] {
  const doc = Bun.YAML.parse(
    readFileSync(`dist/.github/workflows/${workflow}.yml`, "utf8"),
  ) as WorkflowDocument;
  const steps = doc.jobs?.[job]?.steps;
  expect(steps, `${workflow}.yml has no job named ${job}`).toBeDefined();
  return (steps ?? []).map((step) => step.name ?? "");
}

describe("environment setup reaches every job that runs project commands", () => {
  for (const { workflow, job, projectCommands, why } of JOBS) {
    test(`${workflow} sets the environment up before "${projectCommands}"`, () => {
      const names = stepNames(workflow, job);
      const setup = names.indexOf(SETUP_STEP);
      const commands = names.indexOf(projectCommands);

      expect(setup, `${workflow} runs ${why} without setting the environment up`).toBeGreaterThan(-1);
      expect(commands, `${workflow} no longer has a step named "${projectCommands}"`).toBeGreaterThan(-1);
      expect(
        setup,
        `in ${workflow}, setup runs after the commands that need it`,
      ).toBeLessThan(commands);
    });
  }

  // Setup runs a project's commands, and a project's commands are not the place
  // for a credential nobody asked to expose. In the agent's run this is load
  // bearing -- the whole confinement rests on secrets not being in the
  // environment when third-party build code runs -- and in the other two it falls
  // out of step order. Either way, nothing should quietly add one.
  test("setup runs before any secret enters the environment", () => {
    for (const { workflow, job } of JOBS) {
      const names = stepNames(workflow, job);
      const setup = names.indexOf(SETUP_STEP);
      const secrets = names.indexOf("Resolve which repository secrets may reach this run");
      if (secrets === -1) continue;
      expect(setup, `${workflow} resolves secrets before running setup commands`).toBeLessThan(secrets);
    }
  });

  /**
   * And no step BEFORE the setup asks for a secret's value.
   *
   * Steps may run ahead of the setup -- the Atoma CLI install has to, because the
   * provider credential check asks that binary and the check itself must come
   * first. What none of them may do is put a secret's VALUE in an environment
   * block, because from there it reaches `/proc/<pid>/environ`, the log, and every
   * process the project's own build code starts.
   *
   * `${{ secrets.NAME != '' }}` is the boolean GitHub computes, and it is the only
   * shape allowed there: a step that needs to know whether a credential exists
   * does not need to hold it. The check in `atomaton-runner` is built on exactly
   * that distinction, and it is a few characters from the version that is not.
   */
  test("no step before the setup carries a secret's value", () => {
    type WorkflowStep = { name?: string; env?: Record<string, string>; with?: Record<string, string> };
    type WorkflowDocument = { jobs?: Record<string, { steps?: WorkflowStep[] }> };

    for (const { workflow, job } of JOBS) {
      const doc = Bun.YAML.parse(
        readFileSync(`dist/.github/workflows/${workflow}.yml`, "utf8"),
      ) as WorkflowDocument;
      const steps = doc.jobs?.[job]?.steps ?? [];
      const setup = steps.findIndex((step) => step.name === SETUP_STEP);
      expect(setup, `${workflow}: the setup step`).toBeGreaterThanOrEqual(0);

      const offenders: string[] = [];
      for (const step of steps.slice(0, setup)) {
        for (const [name, value] of Object.entries({ ...step.env, ...step.with })) {
          if (!value?.includes("secrets.")) continue;
          if (/!=\s*''/.test(value)) continue;
          offenders.push(`${workflow}: ${step.name ?? "?"} / ${name} = ${value}`);
        }
      }
      expect(
        offenders,
        `a step before the environment setup would put a credential's value in its environment. ` +
          `Use \`secrets.NAME != ''\` if what it needs is whether the credential exists`,
      ).toEqual([]);
    }
  });
});

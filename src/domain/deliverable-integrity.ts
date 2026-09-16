/**
 * deliverable-integrity.ts — whether the `.github/atomaton/` a pull request would
 * merge is internally consistent, decided from its content and nothing else.
 *
 * ## What this is for
 *
 * A name in configuration that resolves to nothing is the one class of defect
 * this project keeps producing and cannot see. `mcp_servers: [filesystem]` with
 * no `filesystem` in tools.yaml aborts the whole run before a single server
 * starts; `chain.labels.in_progres` guards work with a label nobody applies; a
 * `merge.gates` entry that fails validation resolves the WHOLE list to empty,
 * so every trigger stops firing. Each of those is silent at merge time and
 * surfaces on whoever triggers the next run.
 *
 * ## What it deliberately does not do
 *
 * No new validator is written here. Every rule below is either a reference that
 * either resolves or does not, or a call to a resolver that already exists and
 * already runs — `resolveMergeGates`,
 * `resolveDeployTargets`, `resolveDeclaredSecrets`. All four are pure functions of
 * a config value, and all four currently run too late to matter: at merge time, at
 * deploy time, when a credential is handed out. Running them at pull-request time
 * adds no opinion, it moves an existing one earlier.
 *
 * Anything that needs a run to find out is out of scope and stays out. Whether a
 * `checks.atoma_runs.commands` entry passes, whether a deploy target's shell
 * works, whether a model answers — none of that is knowable from the files, and
 * pretending otherwise would make this a second, worse CI.
 *
 * ## Where the agent definitions and tools.yaml are checked
 *
 * Not here. `atoma validate --agent-def X.md --tools-file tools.yaml` already
 * checks the parse, `mcp_servers` against the tools file, `knows_about` targets,
 * `extra_body` reserved keys and the hook paths the tools
 * file names — using the same code the run itself uses. `validate_deliverable.ts`
 * calls it once per agent definition rather than reimplementing any of that in
 * TypeScript, which would be the same facts in two languages.
 *
 * So this module owns exactly one format: config.yaml, which is delivery's own and
 * which the core has never heard of.
 */
import { isControlCommand } from "./control-commands.ts";
import { resolveDeclaredSecrets, SECRET_DESTINATIONS } from "./declared-secrets.ts";
import { resolveDeployTargets } from "./deploy-targets.ts";
import { resolveMergeGates } from "./merge-gates.ts";
import { DEFAULT_CD_WORKFLOW, DEFAULT_CI_WORKFLOW } from "./shipped-workflows.ts";

/**
 * One section of config.yaml, or `null` for a value whose interior config.yaml
 * does not describe.
 *
 * `null` is not "anything goes" — it is "the key is recognised and something else
 * decides what may be in it". `merge.gates` and `deploy.atoma_runs.targets`
 * are both `null` here and both validated below by their own resolver.
 */
interface Section {
  /** Keys recognised by name. */
  readonly children?: Readonly<Record<string, Section | null>>;
  /**
   * Present when any name is legal at this level, and the shape each one takes.
   *
   * `chain.labels` is the case that needs it: three names with meanings, and an
   * index signature for a project's own.
   */
  readonly anyName?: Section | null;
}

/**
 * config.yaml's recognised keys.
 *
 * `AtomaConfig` in `lib/types.ts` is the definition; this is the runtime mirror,
 * because an interface is erased before anything can consult it.
 * `config-contract.test.ts` extracts the interface's keys with TypeScript's own
 * parser and asserts this tree matches exactly — so a key added to the type and
 * not to this tree fails a test rather than being reported to an adopter as
 * unrecognised.
 *
 * That test is the whole reason this is safe to have. Without it the two lists
 * drift in the worst direction: a key the code reads, reported here as a typo.
 */
const CONFIG_SCHEMA: Section = {
  children: {
    base_branch: null,
    environment: { children: { setup_commands: null, max_reloads: null } },
    checks: {
      children: {
        atoma_runs: { children: { commands: null, secrets: null, runs_on: null } },
        your_workflow: null,
      },
    },
    deploy: {
      children: {
        atoma_runs: { children: { targets: null, secrets: null, runs_on: null } },
        your_workflow: null,
      },
    },
    merge: { children: { policy: null, governed_paths: null, gates: null } },
    chain: {
      children: {
        after_handoffs: null,
        after_runs_without_change: null,
        labels: { children: { in_progress: null, sub_issue: null, launched: null }, anyName: null },
      },
    },
    // `servers` is not enumerated: every key inside a server entry is passed to the
    // core verbatim, so listing them here would refuse a setting the core accepts --
    // `url` and `headers` for a remote server, and whatever a later release adds.
    tools: {
      children: {
        secrets: null,
        watch: { anyName: null },
        servers: { anyName: { anyName: null } },
        packages: { children: { npm: null, bun: null, pip: null } },
      },
    },
  },
};

/**
 * The `atoma_runs` arm of a `checks` or `deploy` section, or an empty one.
 *
 * Both sections have two arms and only one can be filled. The other arm names a
 * workflow of the project's own, and nothing inside it is Atoma's to validate --
 * so an absent `atoma_runs` is a project that made the other choice, not a fault.
 */
function arm(section: unknown): Record<string, unknown> {
  if (!isRecord(section)) return {};
  return isRecord(section.atoma_runs) ? section.atoma_runs : {};
}

/**
 * Every key the schema recognises, as dotted paths, with `*` for a level where
 * any name is legal.
 *
 * Exported for `config-contract.test.ts`, which compares this against the same
 * projection of the `AtomaConfig` interface.
 */
export function knownConfigKeys(): string[] {
  const paths: string[] = [];
  const walk = (section: Section, prefix: string): void => {
    for (const [name, child] of Object.entries(section.children ?? {})) {
      const path = `${prefix}${name}`;
      paths.push(path);
      if (child) walk(child, `${path}.`);
    }
    if (section.anyName !== undefined) {
      const path = `${prefix}*`;
      paths.push(path);
      if (section.anyName) walk(section.anyName, `${path}.`);
    }
  };
  walk(CONFIG_SCHEMA, "");
  return paths.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys present in `value` that the schema does not recognise, as dotted paths. */
function unknownKeys(value: unknown, section: Section, prefix: string): string[] {
  if (!isRecord(value)) return [];
  const unknown: string[] = [];
  for (const [name, child] of Object.entries(value)) {
    const path = `${prefix}${name}`;
    const declared = section.children?.[name];
    if (declared !== undefined) {
      if (declared) unknown.push(...unknownKeys(child, declared, `${path}.`));
      continue;
    }
    if (section.anyName !== undefined) {
      if (section.anyName) unknown.push(...unknownKeys(child, section.anyName, `${path}.`));
      continue;
    }
    unknown.push(path);
  }
  return unknown;
}

/**
 * What the deliverable's own files say about itself, gathered by the caller.
 *
 * Passed in rather than read here so this module stays a pure function of its
 * input and the whole rule set is testable without a directory on disk.
 */
export interface DeliverableFacts {
  /** Parsed config.yaml. */
  readonly config: unknown;
  /** Agent names available, one per `agent-definitions/<name>.md`. */
  readonly agentNames: readonly string[];
  /** File names present in `.github/workflows/`, e.g. `atoma-check.yml`. */
  readonly workflowFiles: readonly string[];
}

/** Kept for the agent-name check below; see its call site. */
function triggerAgent(agent: string): string {
  // `$dispatch_agent` and anything else `$`-prefixed is filled in from the event
  // — see `match_trigger.ts`. There is no name here to check against a file.
  return agent.startsWith("$") ? "" : agent;
}

/**
 * Every way this config.yaml is inconsistent with the deliverable around it.
 *
 * Returns all of them rather than the first, so one pull request reports
 * everything an agent has to fix instead of one thing per round trip.
 */
export function configProblems(facts: DeliverableFacts): string[] {
  const problems: string[] = [];
  const { config, agentNames, workflowFiles } = facts;

  if (!isRecord(config)) {
    return ["`config.yaml` must be a YAML mapping."];
  }

  // ── keys nothing reads ────────────────────────────────────────────────────
  //
  // The failure this catches is total silence. A misspelled `merge.governed_path`
  // is not an error anywhere: the reader asks for `merge.governed_paths`, gets
  // undefined, takes the default, and the setting the author wrote has no effect
  // at all.
  for (const key of unknownKeys(config, CONFIG_SCHEMA, "").sort()) {
    problems.push(`\`${key}\` in config.yaml is not a setting Atoma reads. Check the spelling.`);
  }

  // ── two arms, and exactly one of them ─────────────────────────────────────
  //
  // `atoma_runs` and `your_workflow` are alternatives, and the structure says so by
  // putting them side by side. Saying it again here is what turns "both are set"
  // from a precedence puzzle -- which one wins, and does the reader remember? --
  // into a sentence naming the one to delete.
  for (const section of ["checks", "deploy"] as const) {
    const value = config[section];
    if (!isRecord(value)) continue;
    if (value.atoma_runs !== undefined && value.your_workflow !== undefined) {
      problems.push(
        "`" +
          section +
          "` sets both `atoma_runs` and `your_workflow`. They are alternatives: " +
          "`your_workflow` dispatches a workflow of your own and nothing reads " +
          "`atoma_runs`. Remove whichever you did not mean.",
      );
    }
  }

  // ── the resolvers, run early ──────────────────────────────────────────────
  const merge = isRecord(config.merge) ? config.merge : {};
  problems.push(...resolveMergeGates(merge.gates).problems);

  // `deploy` and `checks` are read for their SHAPE only, which is not the same as
  // taking direction from them. Letting an adopter's pipeline configure this
  // validation — running their commands, deciding what to check from their config
  // — is ruled out. Asking whether `deploy.atoma_runs.targets` is a well-formed
  // array of targets is this deliverable validating itself, and the alternative is
  // what happens today: `resolveDeployTargets` reports it after the merge, from
  // the deploy run, where nobody is watching.
  //
  // `checks` and `deploy` carry theirs inside `atoma_runs` -- the arm that declares
  // what Atoma runs also declares what that run may reach. A project naming its own
  // workflow hands that workflow its own secrets. `tools` has no arms: the servers
  // are always Atoma's.
  const deployRuns = arm(config.deploy);
  problems.push(...resolveDeployTargets(deployRuns.targets).problems);

  const checkRuns = arm(config.checks);
  const tools = isRecord(config.tools) ? config.tools : {};
  problems.push(...resolveDeclaredSecrets(tools.secrets, SECRET_DESTINATIONS.tools).problems);
  problems.push(...resolveDeclaredSecrets(checkRuns.secrets, SECRET_DESTINATIONS.checks).problems);
  problems.push(...resolveDeclaredSecrets(deployRuns.secrets, SECRET_DESTINATIONS.deploy).problems);

  // ── a name that resolves to two things ────────────────────────────────────
  //
  // The inverse of every other rule here, and worth checking for the same reason:
  // `/stop` is read as a control command before the agent namespace is consulted, so
  // an agent definition called `stop.md` can never be invoked. Silently, and only
  // for that one agent.
  for (const name of agentNames.filter(isControlCommand).sort()) {
    problems.push(
      `agent-definitions/${name}.md is named after the '/${name}' control command, ` +
        `so '/${name}' will never dispatch it. Rename the agent.`,
    );
  }

  // ── names that have to resolve to a file ──────────────────────────────────
  //
  // Only checked when the definitions were found at all. An empty set means the
  // directory was not there, and reporting every agent as missing would bury the
  // one problem that matters under noise.
  if (agentNames.length === 0) {
    problems.push("No agent definitions were found. `.github/atomaton/agent-definitions/*.md` is empty or missing.");
  }

  // ── the two workflows a dispatch names ────────────────────────────────────
  //
  // A name that is not a file fails at `gh workflow run`, which is the moment
  // there is no longer anywhere to report it: the CI dispatch fails inside
  // `validate_pull_request.ts` and the pull request loses its required check with
  // no agent scheduled after it.
  if (workflowFiles.length > 0) {
    const present = new Set(workflowFiles);
    // The other arm of `checks` and `deploy`, not a section of its own: a project
    // either hands Atoma its commands or hands it a workflow.
    for (const [section, fallback] of [
      ["checks", DEFAULT_CI_WORKFLOW],
      ["deploy", DEFAULT_CD_WORKFLOW],
    ] as const) {
      const named = isRecord(config[section]) ? (config[section] as Record<string, unknown>).your_workflow : undefined;
      const configured = typeof named === "string" ? named.trim() : "";
      const effective = configured || fallback;
      if (!present.has(effective)) {
        problems.push(
          `\`${section}.your_workflow\` resolves to '${effective}', which is not a file in .github/workflows/. ` +
            (configured ? "Check the name." : "The shipped default is missing from this repository."),
        );
      }
    }
  }

  // ── labels ───────────────────────────────────────────────────────────────
  //
  // A label configured as "" is applied as "" and matched as "", so a filter on it
  // finds nothing and the count that gates a parent's dispatch never reaches zero.
  // They live under `chain`, with the rest of the vocabulary one run leaves for
  // the next to read.
  const chain = isRecord(config.chain) ? config.chain : {};
  if (isRecord(chain.labels)) {
    for (const [key, value] of Object.entries(chain.labels)) {
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(`\`chain.labels.${key}\` must be a non-empty label name.`);
      }
    }
  }

  return problems;
}

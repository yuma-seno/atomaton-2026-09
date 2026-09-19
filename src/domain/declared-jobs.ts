/**
 * declared-jobs.ts — one unit of work a project declares in `config.yaml`, validated.
 *
 * Three places in the configuration describe the same thing: a named piece of work,
 * the machine it runs on, and the commands that are it. They had three shapes.
 * `checks.pull_request_runs` was a bare list of commands in one job;
 * `checks.default_branch_runs.jobs` was a list of named jobs that could name secrets;
 * `deploy` had targets with their own spelling again. This is the one shape.
 *
 * ## What differs, and why it is the only thing that differs
 *
 * **Whether an entry may name a secret.** That is not a preference, it is the trust
 * boundary itself.
 *
 * A pull request may rewrite any command it declares, so a credential named beside
 * one is a credential the change being judged can read. There is therefore nowhere to
 * write it: `secretsAllowed` is false for that list, and naming one is refused rather
 * than quietly dropped. Where the commands come from the default branch — or run
 * after a merge — a pull request cannot choose what runs, and a credential is safe to
 * name.
 *
 * The arrangement nobody should write is not a rule to remember. It has no spelling.
 *
 * ## What is NOT decided here
 *
 * When a job runs. A check runs on a pull request; a deployment runs on a merge or a
 * tag. That belongs to whoever owns the list, because it is the thing that differs
 * between them — and folding it in here would put a `branches:` key on a lint job.
 *
 * Problems come back rather than throwing, and every entry is checked rather than
 * stopping at the first: somebody fixing their configuration should see everything
 * wrong with it.
 */
import { DEFAULT_RUNNER, resolveRunsOn } from "./runner-label.ts";

/** One named piece of work, as configuration declares it. */
export interface DeclaredJob {
  /** Its job name in the workflow, and how a failure names itself. */
  readonly name: string;
  /** The labels a runner must have. One entry is an ordinary hosted runner. */
  readonly runsOn: readonly string[];
  /** Run in order, stopping at the first failure. */
  readonly commands: readonly string[];
  /**
   * Repository secrets this job may reach, by name. Only this job receives them.
   *
   * Always empty where `secretsAllowed` is false, and empty is the ordinary answer
   * everywhere else too.
   */
  readonly secrets: readonly string[];
}

export interface DeclaredJobsResolution {
  readonly jobs: readonly DeclaredJob[];
  readonly problems: readonly string[];
}

export interface DeclaredJobsRules {
  /** How to name this list in a message — `checks.from_pull_request`, say. */
  readonly where: string;
  /** Whether an entry here may name repository secrets. See the header. */
  readonly secretsAllowed: boolean;
  /** Keys this list allows beyond the shared ones, so a typo is still caught. */
  readonly extraKeys?: readonly string[];
}

/** Lowercase, hyphenated: it becomes a job name, and GitHub shows it as written. */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The keys every list understands. Anything else is a typo unless its owner allows it. */
const SHARED_KEYS = ["name", "runs_on", "commands", "secrets"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a list of declared jobs.
 *
 * An absent list is an empty one and not a problem: declaring none is the shipped
 * default everywhere this is used.
 */
export function resolveDeclaredJobs(raw: unknown, rules: DeclaredJobsRules): DeclaredJobsResolution {
  if (raw === undefined || raw === null) return { jobs: [], problems: [] };
  if (!Array.isArray(raw)) return { jobs: [], problems: [`\`${rules.where}\` must be an array.`] };

  const problems: string[] = [];
  const jobs: DeclaredJob[] = [];
  const seen = new Set<string>();
  const allowed = new Set<string>([...SHARED_KEYS, ...(rules.extraKeys ?? [])]);

  raw.forEach((entry, index) => {
    const where = `\`${rules.where}[${index}]\``;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      return;
    }

    // A misspelled key is silently nothing, and the job then runs without whatever it
    // was meant to carry -- a `secret:` that should have been `secrets:` is a job that
    // starts with no credential and fails somewhere further in.
    const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      problems.push(`${where}: unknown key(s) ${unknown.map((k) => `\`${k}\``).join(", ")}.`);
      return;
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!NAME_PATTERN.test(name)) {
      problems.push(`${where}: \`name\` must be lowercase letters, digits and hyphens — e.g. 'cloud-names'.`);
      return;
    }
    if (seen.has(name)) {
      problems.push(`${where}: '${name}' is declared more than once.`);
      return;
    }

    const commandsRaw = entry.commands ?? [];
    if (!Array.isArray(commandsRaw) || commandsRaw.some((c) => typeof c !== "string" || c.trim() === "")) {
      problems.push(`${where}: \`commands\` must be an array of non-empty shell commands.`);
      return;
    }
    const commands = (commandsRaw as string[]).map((c) => c.trim());
    // A job that runs nothing is a job that passes, and something that always passes
    // is the shape every guard here has failed in: it looks like cover and is not.
    if (commands.length === 0) {
      problems.push(`${where}: \`commands\` is empty, so this job would do nothing and report success.`);
      return;
    }

    const secretsRaw = entry.secrets ?? [];
    if (!Array.isArray(secretsRaw) || secretsRaw.some((s) => typeof s !== "string" || s.trim() === "")) {
      problems.push(`${where}: \`secrets\` must be an array of repository secret names.`);
      return;
    }
    const secrets = (secretsRaw as string[]).map((s) => s.trim());
    // Refused, not dropped. A credential silently ignored is a job that behaves as
    // though it had one until the command that needs it fails, and the reason is in
    // neither the log nor the configuration.
    if (!rules.secretsAllowed && secrets.length > 0) {
      problems.push(
        `${where}: \`secrets\` cannot be named here. These commands come from the pull request, ` +
          `which may rewrite them, so a credential named beside them is one the change being judged can read.`,
      );
      return;
    }

    const runner = resolveRunsOn(entry.runs_on);
    for (const problem of runner.problems) problems.push(`${where}: ${problem}`);

    seen.add(name);
    jobs.push({ name, runsOn: runner.labels, commands, secrets });
  });

  return { jobs, problems };
}

export { DEFAULT_RUNNER };

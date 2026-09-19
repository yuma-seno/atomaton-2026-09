/**
 * inspect-jobs.ts — `checks.default_branch_runs.jobs`, validated.
 *
 * A check comes in one of two kinds, and the section it is written in says which.
 *
 * `checks.pull_request_runs` runs the commands the pull request itself declares, in
 * the pull request's own tree. No repository secret reaches it, because a credential
 * there is a credential the change being judged can read: a pull request may rewrite
 * any command in its own configuration.
 *
 * These are the other kind. The commands come from the default branch, so a pull
 * request cannot choose what runs, and they may therefore hold credentials. The pull
 * request arrives as a path to read — `$ATOMATON_PR_TREE` — under the same rule
 * `validate_deliverable.ts` states about `--root`: data, never code.
 *
 * The third combination has no spelling. A pull request's own commands and a
 * repository secret cannot be named in one job, so the arrangement nobody should
 * write is not a rule to remember; there is nowhere to write it.
 *
 * What that rule cannot enforce is a default-branch command that goes on to execute
 * something out of the tree it was given. Nothing mechanical stops it — `noexec`
 * would not, since an interpreter reads a file rather than executing it — so it rests
 * on review, which is why keeping this list short matters.
 *
 * Problems come back rather than throwing, so the deliverable check reports all of
 * them at once instead of the first.
 */

/** One credentialed check: the default branch's commands, run as its own job. */
export interface InspectJob {
  /** Its job name in the workflow, and how a failure names itself. */
  readonly name: string;
  /** Run in order, stopping at the first failure. */
  readonly commands: readonly string[];
  /** Repository secrets this job may reach, by name. Only this job receives them. */
  readonly secrets: readonly string[];
}

export interface InspectJobsResolution {
  readonly jobs: readonly InspectJob[];
  readonly problems: readonly string[];
}

/** Lowercase, hyphenated: it becomes a job name, and GitHub shows it as written. */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveInspectJobs(raw: unknown): InspectJobsResolution {
  if (raw === undefined || raw === null) return { jobs: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { jobs: [], problems: ["`checks.default_branch_runs.jobs` must be an array."] };
  }

  const problems: string[] = [];
  const jobs: InspectJob[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const where = `\`checks.default_branch_runs.jobs[${index}]\``;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
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
    // A job that runs nothing is a job that passes, and a check that always passes is
    // the shape every guard here has failed in: it looks like cover and is not.
    if (commands.length === 0) {
      problems.push(`${where}: \`commands\` is empty, so this job would pass without checking anything.`);
      return;
    }

    const secretsRaw = entry.secrets ?? [];
    if (!Array.isArray(secretsRaw) || secretsRaw.some((s) => typeof s !== "string" || s.trim() === "")) {
      problems.push(`${where}: \`secrets\` must be an array of repository secret names.`);
      return;
    }

    seen.add(name);
    jobs.push({ name, commands, secrets: (secretsRaw as string[]).map((s) => s.trim()) });
  });

  return { jobs, problems };
}

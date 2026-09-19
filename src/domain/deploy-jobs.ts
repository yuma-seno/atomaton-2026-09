/**
 * deploy-jobs.ts — what this project deploys, split by the event that deploys it.
 *
 * A deployment is a `domain/declared-jobs.ts` entry: a name, a runner, commands and
 * the credentials those commands may reach. It is configuration rather than a
 * workflow file because an agent can write configuration and cannot write a
 * workflow: GITHUB_TOKEN is refused on `.github/workflows/**` by identity, on every
 * path and every branch, so a project whose CD an agent is expected to author has to
 * express it somewhere else. Everything a deployment actually does — building,
 * uploading, calling a provider's CLI — is a command, and commands are ordinary file
 * content.
 *
 * ## Why three lists rather than one with an `on:` key
 *
 * Because the entries are not the same shape. A merge deployment is selected by
 * BRANCH and a tag deployment by TAG PATTERN, and an `on: merge` entry with a `tags:`
 * beside it is a deployment that will never happen. That used to be a validation
 * rule, which is the weaker arrangement twice over: the author writes it, reads a
 * refusal, and has to be told what the shape should have been.
 *
 * Under three lists the key is simply not there to write. `branches:` exists in
 * `on_merge` and nowhere else; `tags:` exists in `on_tag` and nowhere else. The
 * combination nobody should write has no spelling — the same move
 * `domain/declared-jobs.ts` makes for a credential beside a pull request's own
 * commands.
 *
 * ## Why the selection is here and not in the workflow
 *
 * `atomaton-deploy.yml` listens for every tag and every branch, and asks this module
 * whether any entry wanted that ref. It cannot listen selectively, because `on:`
 * takes no expression and so cannot be driven from configuration. Filtering after the
 * fact costs a few seconds of runner time on a push nobody deploys, which is the
 * price of letting the pattern live somewhere an agent can edit.
 *
 * Schedules are deliberately absent. A cron expression can only be written in `on:`,
 * so it cannot come from configuration, and a fixed daily cron that checks the time
 * in a script burns 24 runs a day to do nothing.
 */
import {
  resolveDeclaredJobs,
  type DeclaredJob,
  type DeclaredJobsRules,
  type ExtraKeys,
} from "./declared-jobs.ts";
import { DEPLOY_JOB_RESERVED } from "./declared-secrets.ts";

/** Which event deploys an entry, which is also which list it is written in. */
export type DeployTrigger = "merge" | "tag" | "demand";

/** `on_merge`: refs whose push deploys this. Empty means the default branch. */
export interface MergeKeys {
  readonly branches: readonly string[];
}

/** `on_tag`: tag patterns this deploys for. Never empty — see `readPatterns`. */
export interface TagKeys {
  readonly tags: readonly string[];
}

export type DeployJob = DeclaredJob & {
  readonly trigger: DeployTrigger;
  /**
   * The refs this entry answers to, from `branches` or `tags` as its list allows.
   * Empty is meaningful only for `merge`, where it means the default branch.
   */
  readonly refs: readonly string[];
};

export interface DeployJobsResolution {
  readonly jobs: readonly DeployJob[];
  readonly problems: readonly string[];
}

/**
 * Whether a ref pattern claims a ref.
 *
 * Deliberately not a glob library, for the same reason `governedPathsIn` is not: a
 * pattern is a literal or a prefix followed by `*`, because that is what tag and
 * branch schemes look like, and a half-implemented glob would be read as a full one.
 */
export function refMatches(pattern: string, ref: string): boolean {
  return pattern.endsWith("*") ? ref.startsWith(pattern.slice(0, -1)) : ref === pattern;
}

/**
 * Why `pattern` is not a form `refMatches` can honour, or "" when it is fine.
 *
 * The same check `pathPatternProblem` performs next door, and it was the one field in
 * an otherwise strict validator that had none. `"v*.*.*"` — the natural way to write
 * a semver tag — was accepted and matched nothing, so the entry validated cleanly and
 * deployed on no tag at all.
 */
export function refPatternProblem(pattern: string): string {
  const body = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
  if (body.includes("*")) {
    return (
      `"${pattern}" uses a '*' somewhere other than the end, which this matcher cannot honour, ` +
      'so it would match nothing. Write a literal ref, or a prefix followed by "*" — e.g. "v*".'
    );
  }
  if (/[?[\]{}]/.test(body)) {
    return (
      `"${pattern}" uses a glob character this matcher cannot honour, so it would match nothing. ` +
      'Write a literal ref, or a prefix followed by "*".'
    );
  }
  return "";
}

/** Reads one list of ref patterns, whichever key its arm calls it. */
function readPatterns(
  raw: unknown,
  key: string,
  required: boolean,
  where: string,
  problems: string[],
): readonly string[] | null {
  const list = raw ?? [];
  if (!Array.isArray(list) || list.some((p) => typeof p !== "string" || p.trim() === "")) {
    problems.push(`${where}: \`${key}\` must be an array of non-empty patterns.`);
    return null;
  }
  const patterns = (list as string[]).map((p) => p.trim());
  const bad = patterns.map(refPatternProblem).find((problem) => problem !== "");
  if (bad) {
    problems.push(`${where}: ${bad}`);
    return null;
  }
  // A tag entry with no pattern would deploy on every tag in the repository, which is
  // never what someone meant to write and is expensive to discover. A merge entry with
  // no branch is the opposite: it is the ordinary case, and it means the default
  // branch.
  if (required && patterns.length === 0) {
    problems.push(`${where}: \`${key}\` needs at least one pattern — e.g. ["v*"].`);
    return null;
  }
  return patterns;
}

function refsFrom(key: string, required: boolean): ExtraKeys<{ refs: readonly string[] }> {
  return {
    keys: [key],
    read: (entry, where, problems) => {
      const refs = readPatterns(entry[key], key, required, where, problems);
      return refs === null ? null : { refs };
    },
  };
}

/**
 * The three lists, each with the key it owns.
 *
 * Every one may name credentials. A deployment runs commands read from a branch a
 * person approved, after the change has landed — the condition that makes a secret
 * safe to name at all, and the one `checks.from_pull_request` cannot meet.
 */
export const DEPLOY_ARMS: Readonly<
  Record<DeployTrigger, { readonly key: string; readonly rules: DeclaredJobsRules<{ refs: readonly string[] }> }>
> = {
  merge: {
    key: "on_merge",
    rules: {
      where: "deploy.on_merge",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: refsFrom("branches", false),
    },
  },
  tag: {
    key: "on_tag",
    rules: {
      where: "deploy.on_tag",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: refsFrom("tags", true),
    },
  },
  demand: {
    key: "on_demand",
    rules: {
      where: "deploy.on_demand",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      // No refs at all: nothing about a ref decides whether somebody asked.
      extra: { keys: [], read: () => ({ refs: [] }) },
    },
  },
};

const TRIGGERS = Object.keys(DEPLOY_ARMS) as readonly DeployTrigger[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the whole `deploy` section.
 *
 * Returns entries only when every one of them is usable. A half-honoured deployment
 * list is the worst outcome available: the run reports success having skipped the
 * target that mattered.
 */
export function resolveDeployJobs(deploy: unknown): DeployJobsResolution {
  const section = isRecord(deploy) ? deploy : {};
  const problems: string[] = [];
  const jobs: DeployJob[] = [];
  const seen = new Set<string>();

  for (const trigger of TRIGGERS) {
    const arm = DEPLOY_ARMS[trigger];
    const resolved = resolveDeclaredJobs(section[arm.key], arm.rules);
    problems.push(...resolved.problems);
    for (const job of resolved.jobs) {
      // Across arms, not within one. A name is how a dispatch asks for a single
      // deployment, so two arms sharing one would make `--target` ambiguous — and the
      // wrong answer there deploys something nobody asked for.
      if (seen.has(job.name)) {
        problems.push(`\`${arm.key}\`: '${job.name}' is already declared in another \`deploy\` list.`);
        continue;
      }
      seen.add(job.name);
      jobs.push({ ...job, trigger });
    }
  }

  return problems.length > 0 ? { jobs: [], problems } : { jobs, problems };
}

/** What a run knows about why it started. */
export interface DeployRequest {
  /** `github.ref` — `refs/tags/<name>` or `refs/heads/<name>`. */
  readonly ref: string;
  /**
   * The repository's default branch, which is what an `on_merge` entry naming no
   * branches means. The run reads it from `github.event.repository.default_branch`.
   */
  readonly defaultBranch: string;
  /** `push` or `workflow_dispatch`. */
  readonly event: string;
  /** A dispatch's `trigger` input: `merge` when `dispatchCd` sent it. */
  readonly trigger: string;
  /** A dispatch's `target` input: one entry by name, from any list. */
  readonly target: string;
}

/** The branch a ref names, or "" when it is not a branch. */
function branchOf(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}

/** The tag a ref names, or "" when it is not a tag. */
function tagOf(ref: string): string {
  return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "";
}

/** Entries that deploy when a change lands on `branch`. */
function mergeJobsFor(jobs: readonly DeployJob[], branch: string, defaultBranch: string): readonly DeployJob[] {
  if (!branch) return [];
  // Naming no branches means the default branch: the ordinary case, and the one an
  // entry should not have to spell out to get.
  return jobs.filter(
    (job) =>
      job.trigger === "merge" &&
      (job.refs.length === 0 ? branch === defaultBranch : job.refs.some((pattern) => refMatches(pattern, branch))),
  );
}

/**
 * Whether a merge into `branch` might deploy anything.
 *
 * A weaker question than `selectDeployJobs`, for a caller deciding only whether to
 * START a run. `dispatchCd` is the one: it runs inside an agent, from a checkout that
 * predates the merge it is reacting to, and it cannot see the repository's default
 * branch from there — nor, when the base is omitted, which branch was merged into.
 *
 * Both unknowns resolve towards yes. Over-starting costs a runner minute and the
 * planner then finds nothing; under-starting loses a deployment silently, which is
 * the failure `dispatchCd` exists to prevent.
 */
export function mergeMightDeploy(jobs: readonly DeployJob[], branch: string): boolean {
  return jobs.some(
    (job) =>
      job.trigger === "merge" &&
      (job.refs.length === 0 || !branch || job.refs.some((pattern) => refMatches(pattern, branch))),
  );
}

/**
 * The entries this run should deploy, or null when the request named a target that
 * does not exist.
 *
 * Matching nothing is a clean empty list, not a failure. A repository tags things for
 * reasons that have nothing to do with deploying, and a red run for each one teaches
 * people to ignore the red. A NAME that matches nothing is different: somebody asked
 * for a specific deployment and it is not there, and deploying something else instead
 * is worse than deploying nothing.
 */
export function selectDeployJobs(
  jobs: readonly DeployJob[],
  request: DeployRequest,
): readonly DeployJob[] | null {
  if (request.target) {
    const named = jobs.find((job) => job.name === request.target);
    return named ? [named] : null;
  }
  if (request.event === "push") {
    const tag = tagOf(request.ref);
    if (tag) return jobs.filter((job) => job.trigger === "tag" && job.refs.some((p) => refMatches(p, tag)));
    return mergeJobsFor(jobs, branchOf(request.ref), request.defaultBranch);
  }
  // A dispatch. `dispatchCd` sends `merge` after an agent's merge, which uses
  // GITHUB_TOKEN and so fires no `push` for anything to catch.
  if (request.trigger === "merge") return mergeJobsFor(jobs, branchOf(request.ref), request.defaultBranch);
  // Nobody named a target and nothing says this is a merge, so it is somebody asking.
  // That is exactly what `on_demand` is, and running the arm whose name is the trigger
  // is the same rule the other two follow.
  return jobs.filter((job) => job.trigger === "demand");
}

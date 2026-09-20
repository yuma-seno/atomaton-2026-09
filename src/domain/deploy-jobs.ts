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
 * Under three lists the key is simply not there to write. `tags:` exists in `on_tag`
 * and nowhere else, so a tag pattern on a merge deployment — a deployment that would
 * never happen — has no spelling. The same move `domain/declared-jobs.ts` makes for a
 * credential beside a pull request's own commands.
 *
 * `branches:` is in two of the three, and that is not the same thing as a key meaning
 * two things. It means "which branch's reviewed content this deployment ships" in
 * both: `on_merge` ships what landed on the branch, `on_tag` ships what a tag points
 * at inside it. The list says which event releases it; `branches` says whose content
 * it is. Orthogonal, so neither reading has to be remembered.
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

/** The keys the ref lists arrive under, shared so a message and a reader agree. */
export interface DeployRefs {
  /**
   * Which branch's reviewed content this deployment ships. Empty means the default
   * branch — the ordinary case, and the one an entry should not have to spell out.
   *
   * It means the same thing in both lists that have it, and that is why it has one
   * name. `on_merge` ships what landed on the branch; `on_tag` ships what a tag
   * points at INSIDE the branch. The list says which event releases it; this says
   * whose reviewed content it is.
   *
   * Never "any branch". A deployment that would accept a commit from anywhere has no
   * spelling, because there is nothing to write that means it.
   */
  readonly branches: readonly string[];
  /** `on_tag` only: which tags this answers to. Never empty there; empty elsewhere. */
  readonly tags: readonly string[];
}

export type DeployJob = DeclaredJob & DeployRefs & { readonly trigger: DeployTrigger };

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

/** The ref keys one list owns. `on_tag` owns both; `on_demand` owns neither. */
function refsFrom(keys: { branches?: boolean; tags?: boolean }): ExtraKeys<DeployRefs> {
  const owned = [...(keys.tags ? ["tags"] : []), ...(keys.branches ? ["branches"] : [])];
  return {
    keys: owned,
    read: (entry, where, problems) => {
      // `tags` is required wherever it exists: an entry claiming every tag in the
      // repository is never what anyone meant. `branches` is the opposite — omitting
      // it is the ordinary way to say "the default branch".
      const tags = keys.tags ? readPatterns(entry.tags, "tags", true, where, problems) : [];
      const branches = keys.branches ? readPatterns(entry.branches, "branches", false, where, problems) : [];
      return tags === null || branches === null ? null : { tags, branches };
    },
  };
}

/**
 * The three lists, and the ref keys each one owns.
 *
 * Every one may name credentials. A deployment runs commands read from a branch a
 * person approved, after the change has landed — the condition that makes a secret
 * safe to name at all, and the one `checks.from_pull_request` cannot meet.
 */
export const DEPLOY_ARMS: Readonly<
  Record<DeployTrigger, { readonly key: string; readonly rules: DeclaredJobsRules<DeployRefs> }>
> = {
  merge: {
    key: "on_merge",
    rules: {
      where: "deploy.on_merge",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      extra: refsFrom({ branches: true }),
    },
  },
  tag: {
    key: "on_tag",
    rules: {
      where: "deploy.on_tag",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      // Both. `tags` says which tags; `branches` says which branch those tags must
      // point into. Without the second, a tag deployment would accept a commit from
      // anywhere -- a feature branch nobody reviewed, tagged by anyone who can push.
      extra: refsFrom({ branches: true, tags: true }),
    },
  },
  demand: {
    key: "on_demand",
    rules: {
      where: "deploy.on_demand",
      secrets: { reserved: DEPLOY_JOB_RESERVED },
      // Neither: nothing about a ref decides whether somebody asked. The empty lists
      // on the resulting entry are never read -- the selector reaches them only for
      // the two arms an event can choose.
      extra: { keys: [], read: () => ({ branches: [], tags: [] }) },
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
  /**
   * Tags this push made reachable — the tags pointing at commits that arrived with
   * it.
   *
   * Gathered by the planner, and only when `needsReachableTags` says so, because it
   * costs an API call and most repositories deploy no tags at all. Empty everywhere
   * else, which is the honest value: nothing became reachable.
   */
  readonly reachableTags: readonly string[];
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
  return jobs.filter((job) => job.trigger === "merge" && coversBranch(job, branch, defaultBranch));
}

/** Entries that deploy for `tag`. */
function tagJobsFor(jobs: readonly DeployJob[], tag: string): readonly DeployJob[] {
  if (!tag) return [];
  return jobs.filter((job) => job.trigger === "tag" && job.tags.some((pattern) => refMatches(pattern, tag)));
}

/**
 * Whether a run started this way may start further runs for tags it creates.
 *
 * A deployment that tags — `gh release create`, say — creates that tag with
 * GITHUB_TOKEN, and GitHub starts no workflow run for its own token's events. So
 * `on_tag` never fired for the tags a project's own release makes, which is the
 * fifth instance of the hole `dispatchCd` exists to bridge. The run that created the
 * tag is the only thing that knows, so it dispatches.
 *
 * Except when it was itself started by a tag. A deployment that tags, started by a
 * tag, would dispatch itself forever; there is no state anywhere that would stop it,
 * so the rule is that a tag run is a leaf.
 */
export function mayDispatchNewTags(request: DeployRequest): boolean {
  return !request.ref.startsWith("refs/tags/") && request.trigger !== "tag";
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
      (job.branches.length === 0 || !branch || job.branches.some((pattern) => refMatches(pattern, branch))),
  );
}

/** One deployment this run will perform, and the tree its commands operate on. */
export interface PlannedDeploy {
  readonly job: DeployJob;
  /** `refs/heads/main`, `refs/tags/v1.0.0` — whatever this deployment ships. */
  readonly ref: string;
}

/**
 * A tag entry that matched a tag, pending the one question this module cannot answer.
 *
 * Whether the tag's commit is inside `branches` is a fact about the repository's
 * history, not about the configuration, so the planner asks GitHub and filters. The
 * decision of WHICH question to ask stays here, with the rest of the policy.
 */
export interface TagCandidate {
  readonly job: DeployJob;
  readonly tag: string;
  /** Resolved, so the caller never has to know that empty means the default branch. */
  readonly branches: readonly string[];
}

export interface DeploySelection {
  /** Decided. Nothing further to ask. */
  readonly ready: readonly PlannedDeploy[];
  /** Deploys only if the tag is inside one of `branches`. */
  readonly tagCandidates: readonly TagCandidate[];
}

/**
 * Whether the planner must work out which tags this push made reachable.
 *
 * Only a branch push, and only when some tag entry ships that branch's content. A
 * repository with no `on_tag` entry never asks, and pays nothing.
 *
 * The question exists because a tag can become deployable without any event naming
 * it: tag a commit on a feature branch, merge the branch, and the tag now points
 * inside the protected branch though no tag was pushed. The merge's own event carries
 * the answer — `before` and `after` bound exactly the commits that just arrived — so
 * nothing has to be remembered between runs.
 */
export function needsReachableTags(jobs: readonly DeployJob[], request: DeployRequest): boolean {
  if (request.target || request.event !== "push") return false;
  const branch = branchOf(request.ref);
  if (!branch) return false;
  return jobs.some((job) => job.trigger === "tag" && coversBranch(job, branch, request.defaultBranch));
}

/** Whether this entry ships `branch`'s content. Naming none means the default branch. */
function coversBranch(job: DeployJob, branch: string, defaultBranch: string): boolean {
  return job.branches.length === 0
    ? branch === defaultBranch
    : job.branches.some((pattern) => refMatches(pattern, branch));
}

/** The branches an entry accepts, with the default filled in. */
function branchesOf(job: DeployJob, defaultBranch: string): readonly string[] {
  return job.branches.length === 0 ? [defaultBranch] : job.branches;
}

function planned(jobs: readonly DeployJob[], ref: string): PlannedDeploy[] {
  return jobs.map((job) => ({ job, ref }));
}

function candidatesFor(
  jobs: readonly DeployJob[],
  tags: readonly string[],
  defaultBranch: string,
): TagCandidate[] {
  return tags.flatMap((tag) =>
    tagJobsFor(jobs, tag).map((job) => ({ job, tag, branches: branchesOf(job, defaultBranch) })),
  );
}

/**
 * What this run should deploy, or null when the request named a target that does not
 * exist.
 *
 * Matching nothing is a clean empty selection, not a failure. A repository tags and
 * pushes for reasons that have nothing to do with deploying, and a red run for each
 * one teaches people to ignore the red. A NAME that matches nothing is different:
 * somebody asked for a specific deployment and it is not there, and deploying
 * something else instead is worse than deploying nothing.
 *
 * ## Two entrances, one judgement
 *
 * A tag reaches a deployment two ways — pushed, or made reachable by a merge — and
 * both produce candidates judged by the same rule. What differs is only where the
 * candidate came from, which is two lines rather than two implementations.
 *
 * Each planned deployment carries its own `ref`, so a tag deployment selected by a
 * branch push still operates on the TAG's tree. Without that the matrix job would
 * check out whatever was pushed and ship the wrong thing while reporting the right
 * name.
 */
export function selectDeployJobs(jobs: readonly DeployJob[], request: DeployRequest): DeploySelection | null {
  const nothing: DeploySelection = { ready: [], tagCandidates: [] };

  // Named by hand, from any list. The ref is the one the dispatch chose, because a
  // person asking for a deployment by name has already said which tree they meant.
  if (request.target) {
    const named = jobs.find((job) => job.name === request.target);
    if (!named) return null;
    return named.trigger === "tag" && tagOf(request.ref)
      ? { ready: [], tagCandidates: candidatesFor([named], [tagOf(request.ref)], request.defaultBranch) }
      : { ready: planned([named], request.ref), tagCandidates: [] };
  }

  const pushedTag = request.event === "push" ? tagOf(request.ref) : "";
  const dispatchedTag = request.trigger === "tag" ? tagOf(request.ref) : "";
  const tag = pushedTag || dispatchedTag;
  if (tag) {
    // `dispatch_new_tags.ts` sends the second kind: a tag a deployment created, which
    // GitHub announces with no event of its own.
    return { ready: [], tagCandidates: candidatesFor(jobs, [tag], request.defaultBranch) };
  }

  const branch = branchOf(request.ref);
  // A branch push, or `dispatchCd` standing in for one: an agent's merge uses
  // GITHUB_TOKEN and so fires no `push` for anything to catch.
  if (request.event === "push" || request.trigger === "merge") {
    if (!branch) return nothing;
    return {
      ready: planned(mergeJobsFor(jobs, branch, request.defaultBranch), request.ref),
      tagCandidates: candidatesFor(jobs, request.reachableTags, request.defaultBranch),
    };
  }

  // Somebody pressed the button and named nothing. `on_demand` entries are reachable
  // only by name -- running every one of them because a form was left blank is not a
  // thing anyone asked for, and a rollback is the usual inhabitant of that list.
  return nothing;
}

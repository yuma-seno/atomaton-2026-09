#!/usr/bin/env bun
/**
 * plan_deploy.ts — which of `deploy`'s entries this run is for, as a matrix.
 *
 * This is the first half of `atomaton-deploy.yml`. Selection happens here rather than
 * in the workflow's `on:` because `on:` takes no expression: a tag pattern or a
 * branch list an agent can edit cannot live there. The workflow starts for every tag
 * and every branch, and this decides whether any entry wanted that ref.
 *
 * How a run is selected — `domain/delivery/deploy-jobs.ts` holds the rule, in one place:
 *
 *   --target NAME      one entry by name, from any list. A name that matches nothing
 *                      fails, rather than falling back to something the caller did
 *                      not ask for.
 *   a pushed tag       every `on_tag` entry whose pattern claims it.
 *   a pushed branch    every `on_merge` entry whose `branches` cover it. Naming none
 *                      means the default branch.
 *   --trigger merge    the same, for a dispatch. `dispatchCd` sends it after an
 *                      agent's merge, which uses GITHUB_TOKEN and so fires no `push`.
 *   any other dispatch every `on_demand` entry. Somebody asked, and that is what the
 *                      list is.
 *
 * Matching nothing publishes `[]`, GitHub skips the matrix job, and the run is green.
 * A repository tags and pushes for reasons that have nothing to do with deploying,
 * and a red run for each one teaches people to ignore the red. A declaration that
 * could not be READ is not the same thing and fails here: a deployment that could not
 * be planned must not read as a repository that deploys nothing.
 *
 * ## Which configuration this reads
 *
 * The DEFAULT BRANCH's, which is why this is a job of its own with its own checkout.
 *
 * This is the most privileged job in the system: it runs commands a project wrote,
 * with the credentials it declared, and it can write to the repository. The workflow
 * now starts for a push to any branch — it has to, or a project could not deploy from
 * one — so the branch that starts a run is no longer the branch that says what a run
 * may do. What deploys, on what machine, with which secrets, comes from the branch a
 * person already approved; the tree being deployed supplies only what the commands
 * operate on.
 *
 * ## And which branches may start one at all
 *
 * The declaration coming from the default branch says what a deployment DOES. It
 * says nothing about whether the commit being deployed was ever reviewed, and
 * `branches: [develop]` is enough to answer that with "no": anyone who can push to
 * `develop` then runs those commands, with those credentials.
 *
 * So a merge deployment's branch has to be covered by a ruleset requiring a pull
 * request, and the run is refused when it is not — or when the rules could not be
 * read. See `deploymentRefusal`.
 *
 * Usage:
 *   plan_deploy.ts --ref refs/tags/v1.0.0 --default-branch main --event push
 *                  [--trigger merge] [--target production]
 */
import { appendFileSync } from "node:fs";
import {
  mayDispatchNewTags,
  needsReachableTags,
  resolveDeployJobs,
  selectDeployJobs,
  type DeployRequest,
  type PlannedDeploy,
  type TagCandidate,
} from "../../domain/delivery/deploy-jobs.ts";
import { deploymentRefusal, readBranchRules } from "../../adapters/github/branch-rules.ts";
import { getDeploySection } from "../../adapters/runner/config.ts";
import { commitsAdded, isContained, readTags, type RepositoryTag } from "../../adapters/github/git-tags.ts";
import { parseAcrossReleases } from "./lib/cli.ts";
import { publishMatrix } from "./lib/publish-matrix.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface PlanDeployArgs {
  /** The ref this run is for; `refs/tags/<name>` selects the tag list. */
  ref: string;
  /** What an entry naming no branches means. */
  "default-branch": string;
  /** `push` or `workflow_dispatch`. */
  event: string;
  /** `merge` when dispatched after a pull request landed. */
  trigger?: string;
  /** A single entry to deploy, by name. */
  target?: string;
  /** `owner/name`, for reading the branch's rules. */
  repo: string;
  /**
   * The commit this ref pointed at before the push, from `github.event.before`.
   *
   * With `ref` it bounds the commits that just arrived, which is how a tag that a
   * merge made reachable is found without anything remembering it. Empty for a
   * dispatch, which added no commits.
   */
  before?: string;
}

export const ref = defineScript<PlanDeployArgs>(import.meta.url);

/**
 * Every branch whose protection has to hold before these deployments may run.
 *
 * One rule, both arms, and that is the whole of what used to be a tag-shaped special
 * case. A deployment ships some branch's reviewed content — `on_merge` the branch the
 * push landed on, `on_tag` the branch its tag points inside — so the branch to check
 * is the branch the entry named, in both.
 *
 * A dispatch by name is exempt. Nothing automatic reached it: somebody with write
 * access chose a deployment and a ref by hand, which is a decision rather than an
 * event, and refusing it would leave no way to run a rollback at all.
 */
function branchesToVerify(selected: readonly PlannedDeploy[], request: DeployRequest): string[] {
  if (request.target) return [];
  const branches = new Set<string>();
  for (const { job } of selected) {
    if (job.trigger === "demand") continue;
    for (const branch of job.branches.length === 0 ? [request.defaultBranch] : job.branches) {
      if (branch) branches.add(branch);
    }
  }
  return [...branches];
}

/**
 * The tags this push made reachable, if any.
 *
 * A tag becomes deployable without any event naming it: tag a commit on a feature
 * branch, merge the branch, and the tag now points inside the protected branch though
 * no tag was ever pushed. The push that merged it carries both ends of the delta, so
 * the answer is in the event rather than in anything remembered between runs.
 */
function reachableTags(repo: string, before: string, ref: string, tags: readonly RepositoryTag[]): string[] {
  if (tags.length === 0) return [];
  const added = commitsAdded(repo, before.trim(), ref);
  if (added === null) {
    console.error(
      "::error::Could not read which commits arrived with this push, so a tag it made reachable " +
        "would not be deployed. Refused rather than skipped.",
    );
    process.exit(1);
  }
  const arrived = new Set(added);
  return tags.filter((tag) => arrived.has(tag.sha)).map((tag) => tag.name);
}

/** The refusal for `branch`, or "" when nothing stands in the way. */
function branchRefusal(repo: string, branch: string): string {
  if (!branch) return "";
  if (!repo) {
    // Fails closed, like every other missing input here. The workflow always passes
    // `--repo`; an older one that did not would otherwise deploy with the check
    // silently skipped, which is the shape this guard exists to refuse.
    return `no repository was given, so the rules on '${branch}' could not be read.`;
  }
  return deploymentRefusal(branch, readBranchRules(repo, branch));
}

/**
 * Publish the tags that exist BEFORE these deployments run, for the job that
 * dispatches whatever they add.
 *
 * Empty means "there is nothing to watch for", and that job is skipped on it. Three
 * ways to get there, and none of them is a failure: the project declares no `on_tag`
 * entry, nothing is deploying so nothing can tag, or this run was itself started by
 * a tag and so must not start another — see `mayDispatchNewTags`.
 *
 * A tag list that could not be READ is none of those. It fails, because the whole
 * point of the comparison is that nothing else would notice a tag deployment going
 * missing. `dispatch_new_tags.ts` has the rest of the reasoning.
 */
function publishTagsBefore(
  jobs: readonly { trigger: string }[],
  selected: readonly unknown[],
  request: DeployRequest,
  tagsNow: () => readonly RepositoryTag[],
): void {
  const watching =
    selected.length > 0 && jobs.some((job) => job.trigger === "tag") && mayDispatchNewTags(request);
  if (!watching) return;

  const names = tagsNow().map((tag) => tag.name);
  const output = process.env.GITHUB_OUTPUT;
  const line = `tags_before=${JSON.stringify(names)}\n`;
  if (output) appendFileSync(output, line);
  else process.stdout.write(line);
  console.error(`Watching for tags these deployments add; ${names.length} exist now.`);
}

/**
 * The tag candidates whose tag really is inside one of the branches its entry names.
 *
 * A candidate that is not is dropped, not refused: tagging a commit that is not on
 * your release branch is an ordinary thing to do, and a red run for it would teach
 * people to ignore the red. It is said out loud, though — an entry whose pattern
 * matched and whose branch did not is exactly the case somebody would otherwise sit
 * and wait for.
 *
 * A containment question that could not be ANSWERED is neither: it fails, because
 * "the tag is not on main" and "GitHub did not say" must not look alike.
 */
/** A tag's commit, by name. Annotated tags resolve through `compare` either way. */
function shaLookup(tags: readonly RepositoryTag[]): (tag: string) => string {
  const byName = new Map(tags.map((tag) => [tag.name, tag.sha]));
  return (tag) => byName.get(tag) ?? tag;
}

function keepTagsInsideTheirBranches(
  repo: string,
  candidates: readonly TagCandidate[],
  tagSha: (tag: string) => string,
): PlannedDeploy[] {
  const answers = new Map<string, boolean>();
  const contained = (branch: string, tag: string): boolean => {
    const key = `${branch}\u0000${tag}`;
    const known = answers.get(key);
    if (known !== undefined) return known;
    const answer = isContained(repo, branch, tagSha(tag));
    if (answer === null) {
      console.error(
        `::error::Could not determine whether '${tag}' is on '${branch}', so this cannot tell ` +
          "whether the commit it points at was ever reviewed. Refused rather than assumed.",
      );
      process.exit(1);
    }
    answers.set(key, answer);
    return answer;
  };

  const kept: PlannedDeploy[] = [];
  for (const candidate of candidates) {
    const branch = candidate.branches.find((name) => contained(name, candidate.tag));
    if (!branch) {
      console.error(
        `'${candidate.tag}' matches \`${candidate.job.name}\`, but is not on ` +
          `${candidate.branches.map((name) => `'${name}'`).join(" or ")}; not deploying it.`,
      );
      continue;
    }
    kept.push({ job: candidate.job, ref: `refs/tags/${candidate.tag}` });
  }
  return kept;
}

export function main(): void {
  // Tolerant of a flag it has not learned yet, because the workflow that runs this
  // comes from a different tree than this script does. See `parseAcrossReleases`.
  const values = parseAcrossReleases(
    ["ref", "default-branch", "event", "trigger", "target", "repo", "before"],
    Bun.argv.slice(2),
  );
  const repo = (values.repo ?? "").trim();

  const { jobs, problems } = resolveDeployJobs(getDeploySection());
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::.github/atomaton/config.yaml: ${problem}`);
    console.error("::error::`deploy` could not be read, so nothing was deployed.");
    process.exit(1);
  }

  const base = {
    ref: values.ref ?? "",
    defaultBranch: (values["default-branch"] ?? "").trim(),
    event: (values.event ?? "").trim(),
    trigger: (values.trigger ?? "").trim(),
    target: (values.target ?? "").trim(),
  };
  // Read at most once, and only when something actually needs it: a repository that
  // deploys no tags never pays for the listing at all.
  let cached: RepositoryTag[] | null | undefined;
  const tagsNow = (): RepositoryTag[] => {
    if (cached === undefined) cached = repo ? readTags(repo) : null;
    if (cached === null) {
      console.error(
        "::error::The repository's tags could not be read, so a tag that should deploy would not. " +
          "A tag deployment is declared, so this is refused rather than skipped.",
      );
      process.exit(1);
    }
    return cached;
  };

  const tags = needsReachableTags(jobs, { ...base, reachableTags: [] }) ? tagsNow() : [];
  const request = { ...base, reachableTags: reachableTags(repo, values.before ?? "", base.ref, tags) };

  const selection = selectDeployJobs(jobs, request);
  if (selection === null) {
    const known = jobs.map((job) => job.name).join(", ") || "none are configured";
    console.error(`::error::No deployment named '${request.target}'. Configured: ${known}.`);
    process.exit(1);
  }

  const selected =
    selection.tagCandidates.length === 0
      ? selection.ready
      : [
          ...selection.ready,
          ...keepTagsInsideTheirBranches(repo, selection.tagCandidates, shaLookup(tagsNow())),
        ];

  // Asked only when something would actually deploy, so an ordinary push to an
  // unprotected feature branch -- which selects nothing -- costs no API call and
  // produces no refusal about a branch nobody was deploying from.
  if (selected.length > 0) {
    for (const branch of branchesToVerify(selected, request)) {
      const refusal = branchRefusal(repo, branch);
      if (refusal) {
        console.error(`::error::${refusal}`);
        console.error(`::error::Refused to deploy: ${selected.map((plan) => plan.job.name).join(", ")}.`);
        process.exit(1);
      }
    }
  }

  publishMatrix(selected, { what: "deployment" });
  publishTagsBefore(jobs, selected, request, tagsNow);
}

if (import.meta.main) main();

#!/usr/bin/env bun
/**
 * plan_deploy.ts — which of `deploy`'s entries this run is for, as a matrix.
 *
 * This is the first half of `atomaton-deploy.yml`. Selection happens here rather than
 * in the workflow's `on:` because `on:` takes no expression: a tag pattern or a
 * branch list an agent can edit cannot live there. The workflow starts for every tag
 * and every branch, and this decides whether any entry wanted that ref.
 *
 * How a run is selected — `domain/deploy-jobs.ts` holds the rule, in one place:
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
import { parseArgs } from "node:util";
import {
  mayDispatchNewTags,
  resolveDeployJobs,
  selectDeployJobs,
  type DeployRequest,
} from "../domain/deploy-jobs.ts";
import { deploymentRefusal, readBranchRules } from "../lib/branch-rules.ts";
import { getDeploySection } from "../lib/config.ts";
import { readTagNames } from "../lib/git-tags.ts";
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
}

export const ref = defineScript<PlanDeployArgs>(import.meta.url);

/**
 * The branch whose protection decides whether this run may deploy, or "" when the
 * question does not arise.
 *
 * A tag is not a branch and has no branch rules to read — GitHub's endpoint answers
 * for branches only. A tag deployment is reached by pushing a tag, which is its own
 * unreviewed path and its own problem; refusing every tag deployment for the want of
 * a branch rule would be answering a question nobody asked.
 */
function branchBeingDeployed(request: { ref: string; event: string; trigger: string }): string {
  if (request.ref.startsWith("refs/tags/")) return "";
  if (request.event !== "push" && request.trigger !== "merge") return "";
  return request.ref.startsWith("refs/heads/") ? request.ref.slice("refs/heads/".length) : "";
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
  repo: string,
  jobs: readonly { trigger: string }[],
  selected: readonly unknown[],
  request: DeployRequest,
): void {
  const watching =
    selected.length > 0 && jobs.some((job) => job.trigger === "tag") && mayDispatchNewTags(request);
  if (!watching) return;

  const tags = repo ? readTagNames(repo) : null;
  if (tags === null) {
    console.error(
      "::error::The repository's tags could not be read, so a tag these deployments create would " +
        "never be deployed. `on_tag` is declared, so this is refused rather than skipped.",
    );
    process.exit(1);
  }
  const output = process.env.GITHUB_OUTPUT;
  const line = `tags_before=${JSON.stringify(tags)}\n`;
  if (output) appendFileSync(output, line);
  else process.stdout.write(line);
  console.error(`Watching for tags these deployments add; ${tags.length} exist now.`);
}

export function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      ref: { type: "string" },
      "default-branch": { type: "string" },
      event: { type: "string" },
      trigger: { type: "string" },
      target: { type: "string" },
      repo: { type: "string" },
    },
  });
  const request = {
    ref: values.ref ?? "",
    defaultBranch: (values["default-branch"] ?? "").trim(),
    event: (values.event ?? "").trim(),
    trigger: (values.trigger ?? "").trim(),
    target: (values.target ?? "").trim(),
  };
  const repo = (values.repo ?? "").trim();

  const { jobs, problems } = resolveDeployJobs(getDeploySection());
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::.github/atomaton/config.yaml: ${problem}`);
    console.error("::error::`deploy` could not be read, so nothing was deployed.");
    process.exit(1);
  }

  const selected = selectDeployJobs(jobs, request);
  if (selected === null) {
    const known = jobs.map((job) => job.name).join(", ") || "none are configured";
    console.error(`::error::No deployment named '${request.target}'. Configured: ${known}.`);
    process.exit(1);
  }

  // Asked only when something would actually deploy, so an ordinary push to an
  // unprotected feature branch -- which selects nothing -- costs no API call and
  // produces no refusal about a branch nobody was deploying from.
  if (selected.length > 0) {
    const refusal = branchRefusal(repo, branchBeingDeployed(request));
    if (refusal) {
      console.error(`::error::${refusal}`);
      console.error(`::error::Refused to deploy: ${selected.map((job) => job.name).join(", ")}.`);
      process.exit(1);
    }
  }

  publishMatrix(selected, { what: "deployment" });
  publishTagsBefore(repo, jobs, selected, request);
}

if (import.meta.main) main();

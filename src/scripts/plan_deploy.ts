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
 * Usage:
 *   plan_deploy.ts --ref refs/tags/v1.0.0 --default-branch main --event push
 *                  [--trigger merge] [--target production]
 */
import { parseArgs } from "node:util";
import { resolveDeployJobs, selectDeployJobs } from "../domain/deploy-jobs.ts";
import { getDeploySection } from "../lib/config.ts";
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
}

export const ref = defineScript<PlanDeployArgs>(import.meta.url);

export function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      ref: { type: "string" },
      "default-branch": { type: "string" },
      event: { type: "string" },
      trigger: { type: "string" },
      target: { type: "string" },
    },
  });
  const request = {
    ref: values.ref ?? "",
    defaultBranch: (values["default-branch"] ?? "").trim(),
    event: (values.event ?? "").trim(),
    trigger: (values.trigger ?? "").trim(),
    target: (values.target ?? "").trim(),
  };

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

  publishMatrix(selected, { what: "deployment" });
}

if (import.meta.main) main();

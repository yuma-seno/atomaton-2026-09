/**
 * check-jobs.ts — the two lists `checks` is made of, and which one may hold a key.
 *
 * Both are `domain/delivery/declared-jobs.ts` lists, and the only thing that separates them is
 * whose commands run. That single fact decides everything else, so it is stated once
 * here and read by everyone who needs it: the reader in `lib/config.ts`, the planner
 * that publishes each arm as a matrix, and the deliverable check that refuses a bad
 * one at pull-request time. Written out at each of those, the rule was three copies
 * of a string and two copies of a security decision.
 */
import { type DeclaredJobsRules } from "./declared-jobs.ts";
import { CHECK_JOB_RESERVED } from "./declared-secrets.ts";

/**
 * The pull request's own commands, in its own tree.
 *
 * Nowhere to name a credential, because a pull request may rewrite any command below
 * it. The refusal is the message an author sees, so it says what is true of the list
 * rather than quoting a rule number.
 */
export const CHECKS_FROM_PULL_REQUEST: DeclaredJobsRules = {
  where: "checks.from_pull_request",
  secrets: {
    refused:
      "These commands come from the pull request, which may rewrite them, so a credential " +
      "named beside them is one the change being judged can read. Move the check to " +
      "`checks.from_default_branch`, where the commands come from a branch a person approved.",
  },
};

/**
 * The default branch's commands, with the pull request handed over as a path to read.
 *
 * A pull request cannot add a job here, rename one, or change which secret one
 * receives, because this list is read from the default branch — see `plan_checks.ts`.
 */
export const CHECKS_FROM_DEFAULT_BRANCH: DeclaredJobsRules = {
  where: "checks.from_default_branch",
  secrets: { reserved: CHECK_JOB_RESERVED },
};

/**
 * Said only for the pull request's arm, because only there is an empty list
 * surprising.
 *
 * A project that declares no credentialed check is the shipped default and the common
 * case. A project that declares nothing to verify a change with has a required check
 * that passes every pull request without looking at it, which is the shape this
 * repository keeps finding: cover that is not.
 */
export const NO_PULL_REQUEST_CHECKS =
  "This check verified nothing: `checks.from_pull_request` in .github/atomaton/config.yaml is empty, " +
  "so a pull request satisfying it has not been tested. Add the commands that check this project, " +
  "or point `checks.your_workflow` at a workflow of your own.";

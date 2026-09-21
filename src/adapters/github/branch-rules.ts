/**
 * branch-rules.ts — what a branch's protection requires, and whether that answer
 * could be determined at all.
 *
 * One reader, because the callers are halves of one contract.
 * `validate_pull_request.ts` writes a Checks API check run for each context this
 * returns; `merge-readiness.ts` then blocks the merge for each context this returns
 * that has no passing run. If the two lists ever differ, the mirror writes the wrong
 * set and the pull request is blocked on a check nothing will ever create —
 * silently, since a duplicated reader would degrade to an empty list on both sides.
 *
 * `plan_deploy.ts` asks the other question the same response answers: whether the
 * branch requires a pull request at all. A deployment reached by pushing straight to
 * a branch is a deployment reached without review.
 *
 * ## Why the result says whether it is known
 *
 * The previous readers returned `string[]` and used `[]` for four different
 * situations: the branch has no rule, the API call failed, the response did not
 * parse, and no base ref was given. Only the first of those means "nothing is
 * required". The rest mean "this could not be determined", and collapsing them
 * cost a real guarantee: `passed = checks.every(...)` is `true` for an empty
 * list, so a failed read reported a **failing** run as passed, which suppressed
 * the failure comment, which is also the retry tally, so the retry limit that
 * bounds the engineer/CI loop could never fire.
 *
 * Returning the distinction makes each caller answer for itself what an unknown
 * means, which is the only place that question can be answered honestly.
 */
import { gh } from "./gh.ts";

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] };
}

/**
 * GitHub's answer when branch rules are not a feature this repository has.
 *
 * Rulesets and branch protection are paid features on a private repository, so a free
 * account gets 403 with this message for every branch. That is a DEFINITE answer --
 * no rule can be required here -- and it is not the same as a read that failed, which
 * is why it gets its own state below rather than being folded into either.
 *
 * Matched on GitHub's wording, which is the only signal the response carries: the
 * status is a plain 403, indistinguishable from a token that lacks the scope. If the
 * wording ever changes this stops matching and the answer falls back to "could not be
 * read", which is the safe direction -- a caller then refuses instead of assuming.
 */
const FEATURE_UNAVAILABLE = /upgrade to github|make this repository public/i;

export type BranchRules =
  /** The branch's protection was read. `contexts` may legitimately be empty. */
  | { known: true; enforceable: true; contexts: string[]; pullRequestRequired: boolean }
  /**
   * This repository cannot have branch rules at all, so nothing is required and
   * nothing ever will be. Known, so a caller proceeds -- but `enforceable: false`,
   * because GitHub will not refuse a merge on this repository's behalf and a caller
   * that gates on merges has to do that itself.
   */
  | { known: true; enforceable: false; contexts: string[]; pullRequestRequired: false; why: string }
  /** The branch's protection could not be read. `why` is for a log or a report. */
  | { known: false; why: string };

/**
 * What the branch's protection requires.
 *
 * Read from the repository rather than hardcoded, so editing
 * `.github/atomaton/rulesets/*.json` changes what is enforced with no code change.
 *
 * `[]` is the measured answer for a branch nothing covers, and for a branch that does
 * not exist -- the endpoint does not distinguish them and neither does this. Both are
 * "nothing is required here", which is the fact every caller needs.
 */
export function readBranchRules(repo: string, baseRef: string): BranchRules {
  if (!baseRef) return { known: false, why: "no base branch was given" };

  const { code, stdout, stderr } = gh("api", `repos/${repo}/rules/branches/${baseRef}`);
  if (code) {
    if (FEATURE_UNAVAILABLE.test(`${stderr} ${stdout}`)) {
      return {
        known: true,
        enforceable: false,
        contexts: [],
        pullRequestRequired: false,
        why:
          "branch rules are not available on this repository (they are a paid feature on a " +
          "private one), so GitHub cannot require a status check or refuse a merge here",
      };
    }
    return { known: false, why: `the branch rules for ${baseRef} could not be read` };
  }

  try {
    const rules = JSON.parse(stdout || "[]") as BranchRule[];
    return {
      known: true,
      enforceable: true,
      contexts: rules
        .filter((rule) => rule.type === "required_status_checks")
        .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
        .map((check) => check.context),
      // Measured: the endpoint reports every rule in effect on the branch, from every
      // ruleset, and a pull-request requirement arrives as this bare type.
      pullRequestRequired: rules.some((rule) => rule.type === "pull_request"),
    };
  } catch {
    return { known: false, why: `the branch rules for ${baseRef} were not valid JSON` };
  }
}

/**
 * Why a deployment must not be started from `branch`, or "" when it may be.
 *
 * A deployment runs commands a project wrote with the credentials it declared, and
 * `contents: write` besides. Reaching one by pushing straight to a branch is
 * reaching it without review — and since `deploy.on_merge` gained a `branches:`
 * key, writing `branches: [develop]` is enough to open that door on a branch
 * nothing protects, with nothing anywhere saying so.
 *
 * So a branch that does not require a pull request cannot start a deployment.
 *
 * **Unreadable is refused too**, and that is the half worth stating. "The rules
 * could not be read" is not "the branch is protected", and treating the two alike
 * is the defect this repository keeps finding: a check whose input is missing must
 * say so rather than pass. The same goes for a repository where rules are not
 * available at all — GitHub will not refuse the direct push, so nothing does.
 *
 * Pure, and separate from the read above, so the decision can be tested without a
 * repository: it is the sentence an operator acts on.
 */
export function deploymentRefusal(branch: string, rules: BranchRules): string {
  if (!rules.known) {
    return (
      `${rules.why}, so whether a pull request is required on '${branch}' could not be established. ` +
      "A deployment runs with credentials, so this is refused rather than assumed: fix the read, " +
      "or move the deployment to a branch whose rules can be seen."
    );
  }
  if (!rules.enforceable) {
    return (
      `${rules.why}. A deployment runs with credentials and GitHub will not refuse a direct push ` +
      `to '${branch}' here, so nothing would stand between an unreviewed commit and those ` +
      "credentials. Deploy from a repository where a ruleset can require a pull request."
    );
  }
  if (!rules.pullRequestRequired) {
    return (
      `'${branch}' is not covered by a ruleset requiring a pull request, so anyone who can push ` +
      "to it can run this deployment's commands with its credentials. Add a ruleset that requires " +
      `a pull request on '${branch}', or deploy from a branch that has one.`
    );
  }
  return "";
}

/**
 * dispatch-targets.ts — the workflows an agent's own actions have to start.
 *
 * One fact, and this is where it is written down: **GitHub starts no workflow run
 * for an event its own token triggered.** An agent opening a pull request fires no
 * `pull_request.opened`; an agent merging fires no `push`; a deployment tagging a
 * release fires no `push` for the tag. Anything that would have chained off those
 * events has to be dispatched explicitly, and `workflow_dispatch` is the documented
 * exception that still runs.
 *
 * Every stand-in for a suppressed event is here, or is `dispatch.ts`'s
 * `dispatchRunner`, and each names the event it replaces:
 *
 * | stand-in | the event GitHub did not deliver |
 * |---|---|
 * | `dispatchPrValidation` | `pull_request.opened`, for an agent's pull request |
 * | `dispatchCi` | `push` to a pull request's head branch |
 * | `dispatchCd` | `push` to the branch a merge landed on |
 * | `dispatchTagDeploy` | `push` of a tag a deployment created |
 * | `dispatchPostMergeAgent` | `pull_request.closed`, when an agent did the merging |
 * | `dispatchRunner` (`dispatch.ts`) | every hand-off from one agent to the next |
 *
 * This header said "All four" while there were five, and three more had been
 * written outside it — two of those in a workflow's own bash, so they ran without
 * `dispatchRunner`'s closed-target guard and wrote no ops-log entry, which is the
 * exact failure `dispatch.ts` was written to make impossible. A count that goes
 * stale is the symptom; `tests/contract/dispatch-sites.test.ts` is what stops the
 * next one being written elsewhere: nothing outside these two modules may start a
 * workflow run.
 *
 * None of them throws, and each returns whether GitHub accepted it. A dispatch that
 * fails must not fail the action that prompted it — a pull request that exists
 * without its CI started is recoverable, one that was never created is not. Whether
 * a refusal is fatal is the CALLER's to decide, and one caller decides it is:
 * `scripts/dispatch_new_tags.ts` fails its job, because a deployment nobody starts
 * is one nobody notices.
 */
import { dispatchWorkflow, gh } from "../../adapters/github/gh.ts";
import { getDeploySection, getWorkflowName } from "../../adapters/runner/config.ts";
import { dispatchRunner } from "./dispatch.ts";
import { resolveNotify } from "../../adapters/github/notify.ts";
import { isIssueBranch } from "../../adapters/github/branch-placement.ts";
import { mergeMightDeploy, resolveDeployJobs, type DeployTrigger } from "../../domain/delivery/deploy-jobs.ts";
import { DEFAULT_CD_WORKFLOW, DEFAULT_CI_WORKFLOW } from "../../domain/delivery/shipped-workflows.ts";

// The two shipped workflow names now live in `domain/delivery/shipped-workflows.ts`. They were
// declared here, in a module that runs `gh` and reads config.yaml, and re-exported from
// here to a workflow generator and — once `deliverable-integrity.ts` needed them — to a
// module that must stay pure. The constants are facts about what this template ships, not
// about dispatching, so they moved to where a pure module can reach them.

function log(message: string): void {
  console.error(`[atomaton-github] ${message}`);
}

/**
 * Run CI on a pull request, and hand it to `reviewer` afterwards if one is named.
 *
 * Validation rather than a reviewer directly: the reviewer used to be dispatched
 * from here and arrived before CI had a verdict, so it either reported that it
 * would wait -- with nothing able to wake it -- or merged without one. Validation
 * runs CI first and dispatches what the result calls for: the reviewer when it
 * passes, the engineer when it does not. See `scripts/validate_pull_request.ts`.
 *
 * Returns whether the dispatch was sent. `create_pr` ends the engineer's session
 * on success, so nothing is left running to notice a failure here: the pull request
 * would sit with no CI, no required check and no agent scheduled, while the tool
 * reported success. The caller keeps the session open instead.
 *
 * The name is a parameter now. It used to come from
 * `getTriggerAgent("pull_request.opened", "reviewer")` -- reading which agent an
 * `auto_triggers` entry routed that event to (that setting is gone), and falling back to the literal
 * `"reviewer"`.
 *
 * That coupling was invisible from either end. The trigger fired only for a
 * HUMAN's pull request, because GitHub starts no workflow run for an event its own
 * token caused, so an agent's pull request reached its reviewer through THIS call
 * while a person's reached it through the trigger. Two halves of one behaviour,
 * each looking like the whole. Removing the trigger would silently have
 * moved every adopter who renamed their reviewer onto the literal fallback.
 *
 * An empty name means nothing is dispatched after CI, which the validate workflow
 * already handled: `next_agent` empty, the failing or passing check stands, and a
 * person picks it up. `create_pr` makes sure they are told.
 */
export function dispatchPrValidation(repo: string, prNumber: number, branch: string, reviewer: string): boolean {
  return dispatchWorkflow(
    `dispatchPrValidation: validating PR #${prNumber}`,
    "atomaton-validate-pr.yml",
    [
      "--repo", repo,
      "-f", `number=${prNumber}`,
      "-f", `branch=${branch}`,
      "-f", `reviewer=${reviewer}`,
      "-f", "engineer=engineer",
    ],
    log,
  );
}

/**
 * After a pull request merges, re-invoke the agent that created it on the linked
 * sub-issue, instead of silently closing that sub-issue here.
 *
 * The agent is named by the `atomaton:origin-agent` tag the pull request body
 * carries. Returns whether the dispatch was sent; the caller falls back to
 * closing the issue directly when it was not.
 *
 * ## The comment asks for a judgement, not for a closure
 *
 * It said "Please confirm completion and close this sub-task", and that is the
 * first user message the re-invoked agent reads -- ahead of its system prompt in
 * the only ordering a model has. So whatever the prompt layer says about weighing
 * what merged against what the issue asked for, this line told it the answer
 * before it looked. A merge is evidence that a change was accepted, not that a
 * requirement was satisfied, and the two come apart often enough that deciding is
 * the reason to re-invoke anybody at all: an agent asked only to confirm has no
 * remaining reason to read the issue.
 *
 * Both halves move together or neither holds. `prompt-template.md`'s "After a
 * pull request you opened has merged" paragraph is the other half.
 */
export function dispatchPostMergeAgent(repo: string, subIssueNum: number, agent: string): boolean {
  const notify = resolveNotify(repo, subIssueNum);
  const { code, stdout, stderr } = gh(
    "issue", "comment", String(subIssueNum), "--repo", repo,
    "--body",
    "Atomaton: the pull request for this issue merged. Decide whether what merged satisfies what " +
      "this issue asked for. Say which acceptance criteria are met and which are not; conclude the " +
      "issue when they are met, and carry on with the work when they are not.",
  );
  if (code) {
    log(`dispatchPostMergeAgent: could not post trigger comment on #${subIssueNum}: ${stderr || stdout}`);
    return false;
  }
  return (
    dispatchRunner({
      context: `the pull request for #${subIssueNum} was merged, so ${agent} was to judge whether it satisfies the issue`,
      agent,
      type: "issue",
      number: subIssueNum,
      notify,
      repo,
      log,
    }) === "dispatched"
  );
}

/** Kick off the CI workflow against a branch, so a fresh agent pull request gets a check run. */
export function dispatchCi(branch: string): boolean {
  return dispatchWorkflow("dispatchCi", getWorkflowName("ci", DEFAULT_CI_WORKFLOW), ["--ref", branch], log);
}

/**
 * Kick off the deployment workflow after a merge.
 *
 * Required, not a nicety: this merge is performed with GITHUB_TOKEN, so it fires
 * no `push` on the base branch and a deployment waiting on that chain never
 * runs.
 *
 * A project either names its own workflow in `deploy.your_workflow`, or declares
 * `deploy.on_merge` and lets `atomaton-deploy.yml` run it. In the second case the
 * decision is made HERE rather than in the workflow: a dispatch that starts a runner
 * only to discover that nothing deploys on merge is a wasted run on every single
 * merge, and this is the one trigger where the question can be answered before
 * starting anything. The tag trigger has no such luxury -- `on:` takes no expression
 * -- so that one filters after the fact.
 *
 * It asks the weaker of the two questions -- `mergeMightDeploy`, not
 * `selectDeployJobs` -- because it knows less than the run does: the config it reads
 * predates the merge it is reacting to, and the repository's default branch is not
 * visible from here. An entry that might apply counts as one that does.
 *
 * A declaration that does not parse is not this function's to report. It fails
 * loudly inside the deploy run, where the log belongs to the deployment; here it
 * would fail a merge that is otherwise complete.
 */
export function dispatchCd(baseRef: string): boolean {
  // Only a merge that actually lands work deploys. A sub-issue's pull request
  // merges into its parent's branch, which is still in progress — deploying
  // there would ship half a feature, once per child.
  if (isIssueBranch(baseRef)) {
    log(`dispatchCd: merged into ${baseRef}, which is work in progress; not deploying`);
    return false;
  }

  // Asked only when Atomaton's own workflow is the one that would run: a project
  // naming its own deployment workflow has told us nothing about when it deploys,
  // so there is no question to answer here and the dispatch goes out.
  if (!getWorkflowName("cd")) {
    const { jobs, problems } = resolveDeployJobs(getDeploySection());
    if (problems.length === 0 && !mergeMightDeploy(jobs, baseRef)) {
      log(
        `dispatchCd: nothing in deploy.on_merge covers ${baseRef || "this branch"}, and deploy.your_workflow is unset; nothing to dispatch`,
      );
      return false;
    }
  }

  return dispatchDeploy("dispatchCd", "merge", baseRef);
}

/**
 * Deploy a tag one of this run's deployments just created.
 *
 * The same hole as `dispatchCd`, one event along: a deployment that cuts a release
 * creates its tag with GITHUB_TOKEN, so no `push` arrives for it and `on_tag` never
 * fires. See `scripts/dispatch_new_tags.ts` for how a run knows which tags are new,
 * and why the dispatching is a job of its own.
 *
 * `repo` is required rather than optional: the only caller runs in a job checked out
 * for the scripts, not for the repository being deployed.
 */
export function dispatchTagDeploy(repo: string, tag: string): boolean {
  return dispatchDeploy(`dispatchTagDeploy: ${tag}`, "tag", tag, repo);
}

/**
 * Start the deployment workflow for one ref, whatever stood in for the `push`.
 *
 * One place, because it is one fact: a project either names its own workflow in
 * `deploy.your_workflow` or lets `atomaton-deploy.yml` run its declarations, and
 * only the shipped one understands the `trigger` input. It was written twice, and
 * the second copy — the tag one, written last — named `atomaton-deploy.yml`
 * outright and sent `trigger=tag` unconditionally. A project that had named its own
 * deployment workflow would have had the wrong workflow started, with an input it
 * does not declare.
 *
 * `trigger` is `DeployTrigger` rather than a string, so the value the workflow
 * branches on and the value sent here are the same three names.
 */
function dispatchDeploy(context: string, trigger: DeployTrigger, ref: string, repo?: string): boolean {
  const configured = getWorkflowName("cd");
  const args = [
    ...(repo ? ["--repo", repo] : []),
    // No `--ref` rather than a guessed one. This used to fall back to `"main"`,
    // in a file that argues a hundred lines above that guessing a workflow name
    // "would dispatch a workflow that does not exist" -- and on a repository whose
    // default branch is `develop`, the guess made the dispatch fail, logged as a
    // WARN, so the merge landed and nothing deployed. Omitted, `gh workflow run`
    // uses the repository's real default branch, which is what `getBaseBranch()`
    // already relies on for the same reason.
    ...(ref ? ["--ref", ref] : []),
    // Only the shipped workflow understands why it was started. A project's own
    // deployment workflow gets the bare dispatch it has always got.
    ...(configured ? [] : ["-f", `trigger=${trigger}`]),
  ];
  return dispatchWorkflow(context, configured || DEFAULT_CD_WORKFLOW, args, log);
}

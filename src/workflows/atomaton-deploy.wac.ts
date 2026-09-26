import { Workflow, type GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";
import { ActionsCheckoutV4 } from "@github-actions-workflow-ts/actions";
import { DefinedJob, JobCondition, TypedOutputsStep } from "./actions/base.ts";
import { COMMANDS_VAR, matrixJob, matrixSecretEnv, RUN_DECLARED_COMMANDS } from "./actions/declared-job.ts";
import { MACHINERY_ROOT, scriptCommandWithArgs } from "./actions/script-call.ts";
import { renameSecretSlots } from "./actions/secret-slots.ts";
import { SetupBunAction } from "./actions/third-party.ts";
import { environmentSetupStep } from "./actions/environment-setup.ts";
import { ref as dispatchNewTagsRef, TAGS_BEFORE_VAR } from "../entrypoints/machinery/dispatch_new_tags.ts";
import { ref as planDeployRef } from "../entrypoints/machinery/plan_deploy.ts";

// Runs whatever config.yaml's `deploy` says this project ships.
//
// Same reason as atomaton-check: GITHUB_TOKEN cannot write `.github/workflows/**`,
// so a deployment an agent is expected to author has to be configuration. This
// is the fixed shell; the deployments, the events that start them and their
// commands are all in config.yaml.
//
// ## One job per deployment, and why
//
// It was one job running every selected deployment in order. That made a release
// and a cloud rollout the same job: one runner, one set of credentials, and a
// failure reported as "deploy" whichever of them broke. Now each entry is its own
// GitHub job, so it picks its own machine and is handed the secrets it named and no
// others -- the arrangement `checks.from_default_branch` already had.
//
// `max-parallel: 1` and `fail-fast: true` keep what the single job did provide:
// declared order, and a stop at the first failure. With one deployment already
// broken, continuing puts more of the estate in an unknown state rather than less.
//
// ## Two triggers, for the events GitHub does and does not send
//
// A pushed tag or branch arrives as an event, and `on:` takes no expression -- a
// pattern an agent can edit cannot live there. So this listens for every tag and
// every branch, and `plan_deploy.ts` decides whether any entry wanted that ref. A
// push nobody deploys plans an empty matrix, skips, and is green; a red run per
// unrelated push would teach people to ignore the red.
//
// An agent merges with GITHUB_TOKEN, which fires no `push`, so `dispatchCd` starts
// this run explicitly with `trigger=merge`. It reads the same lists before
// dispatching and does not start a run when nothing deploys on a merge there, so
// that path costs nothing when unused.
//
// `branches: ["**"]`, where it used to be `["main", "master"]` with the job
// narrowing it again to the real default branch. That pair was the whole of
// `deploy`'s branch handling, and it meant `on_merge` could only ever mean the
// default branch: a project deploying a staging environment from `develop` wrote
// the configuration, and a person's merge to `develop` started no run at all. The
// branch an entry answers to is now the entry's own `branches:`, read from the
// default branch by the planning job below.
//
// Schedules are absent on purpose: a cron expression can only be written in `on:`,
// so it cannot come from configuration, and a fixed daily cron that checks the time
// in a script burns 24 runs a day to do nothing.

const PLAN_JOB = "plan-deploy";
const DEPLOY_JOB = "deploy";
const DISPATCH_TAGS_JOB = "dispatch-new-tags";
const PLAN_STEP_ID = "plan";

/**
 * Read `deploy` from the DEFAULT BRANCH and publish what this run deploys.
 *
 * Its own job with its own checkout, and that separation is the security story of
 * this workflow. The run below holds `contents: write`, an OIDC identity and every
 * credential its entry named; the branch that STARTED it must not also be the branch
 * that says what it may do. Since this workflow now starts for a push to any branch
 * — it has to, or a project could not deploy from one — that would otherwise be a
 * pushed branch choosing its own deployment and its own secrets.
 *
 * So: what deploys comes from the branch a person approved, and the tree being
 * deployed supplies only what the commands operate on. It is the same split
 * `plan-default-branch-checks` makes, for the same reason.
 */
const planJob = new DefinedJob<{ jobs: string; tags_before: string }>(
  PLAN_JOB,
  {
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    permissions: { contents: "read" },
    outputs: {
      jobs: `\${{ steps.${PLAN_STEP_ID}.outputs.jobs }}`,
      // The tags that existed before anything deployed. Empty when there is nothing
      // to watch for, which is what skips the job below.
      tags_before: `\${{ steps.${PLAN_STEP_ID}.outputs.tags_before }}`,
    },
  },
  [
    new ActionsCheckoutV4({
      name: "Checkout the default branch, which decides what may be deployed",
      with: { ref: "${{ github.event.repository.default_branch }}" },
    }),
    new SetupBunAction({ name: "Setup Bun" }),
    new TypedOutputsStep({
      name: "Read `deploy` and select what this run is for",
      id: PLAN_STEP_ID,
      shell: "bash",
      env: {
        ATOMATON_DEPLOY_REF: "${{ github.ref }}",
        ATOMATON_DEPLOY_EVENT: "${{ github.event_name }}",
        ATOMATON_DEPLOY_TRIGGER: "${{ inputs.trigger }}",
        ATOMATON_DEPLOY_TARGET_INPUT: "${{ inputs.target }}",
        ATOMATON_DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
        ATOMATON_REPO: "${{ github.repository }}",
        // The other end of this push. A tag can become deployable without any event
        // naming it -- tag a commit on a branch, merge the branch, and the tag now
        // points inside the protected branch -- and `before...after` is exactly the
        // commits that arrived, so nothing has to be remembered between runs. Empty
        // for a dispatch, which added no commits.
        ATOMATON_PUSH_BEFORE: "${{ github.event.before }}",
        // To read the branch's rules, which is how this job finds out whether the
        // commit being deployed had to pass through a pull request. Nothing declared
        // reaches this job, so there is no credential here to shadow.
        GH_TOKEN: "${{ github.token }}",
      },
      // The default branch may predate this script, and says so rather than answering
      // as though it had looked. It happens during an upgrade: a branch carrying the
      // new workflow is pushed before the release reaches the default branch, and the
      // workflow file comes from the branch while this checkout comes from the default
      // branch.
      //
      // `[]` is what it publishes, because there is nothing it can plan. The warning
      // is what keeps that from being silent: "no entry wanted this ref" and "the
      // question could not be asked" look identical afterwards, and only one of them
      // is a repository that deploys nothing here.
      run: [
        `PLANNER="${MACHINERY_ROOT}/${planDeployRef.runtimePath}"`,
        'if [ ! -f "$PLANNER" ]; then',
        '  echo "::warning::$PLANNER is not on the default branch yet, so nothing could be planned and nothing was deployed. This is expected once, on the upgrade that adds it."',
        `  echo "jobs=[]" >> "\$GITHUB_OUTPUT"`,
        "  exit 0",
        "fi",
        scriptCommandWithArgs(planDeployRef, {
          ref: "${ATOMATON_DEPLOY_REF}",
          "default-branch": "${ATOMATON_DEFAULT_BRANCH}",
          event: "${ATOMATON_DEPLOY_EVENT}",
          trigger: "${ATOMATON_DEPLOY_TRIGGER}",
          target: "${ATOMATON_DEPLOY_TARGET_INPUT}",
          repo: "${ATOMATON_REPO}",
          before: "${ATOMATON_PUSH_BEFORE}",
        }),
        "",
      ].join("\n"),
    }),
  ],
);

/**
 * One deployment's commands, with the credentials that one entry named.
 *
 * The checkout is the ref being deployed, not the default branch the plan came from.
 * A tag deployment builds and ships THAT tag; the commands say what to do and the
 * tree says what to do it to.
 */
const runStep = new TypedOutputsStep({
  name: "Run this deployment's commands",
  shell: "bash",
  env: {
    ...matrixSecretEnv(),
    [COMMANDS_VAR]: "${{ toJSON(matrix.commands) }}",
    // Lets a command tell which deployment it is running under, so one script can
    // serve several entries without each repeating its own name in every line.
    ATOMATON_DEPLOY_TARGET: "${{ matrix.name }}",
    // The other half of `contents: write`. That permission is what lets a deployment
    // create a release or a tag, and this is what it uses to do it -- granting the
    // one without the other is a permission nothing can reach.
    GH_TOKEN: "${{ github.token }}",
  },
  run: renameSecretSlots() + "\n" + RUN_DECLARED_COMMANDS,
});

const deployJob = matrixJob(
  DEPLOY_JOB,
  planJob,
  {
    timeoutMinutes: 60,
    // One deployment at a time, in declared order, stopping at the first failure --
    // what the single job used to provide by running them in a loop.
    failFast: true,
    maxParallel: 1,
    permissions: {
      // Write because cutting a release is a deployment, and the commonest thing a
      // deployment does on GitHub itself is create a release or a tag. Read would
      // mean every project that ships that way needs a personal access token in its
      // entry's `secrets` instead -- a long-lived credential, manually rotated,
      // usually scoped wider than this. The weaker-looking permission produces the
      // worse arrangement.
      contents: "write",
      // So a deployment can exchange the run's identity for short-lived cloud
      // credentials instead of a long-lived key in a repository secret. Declared
      // here because a job's `permissions:` is one of the few things a command
      // genuinely cannot express -- unused, it grants nothing.
      "id-token": "write",
    },
  },
  [
    // Each entry says which tree it operates on, because they can differ within one
    // run: a merge that makes a tag reachable deploys both that branch's entries and
    // that tag's, and the tag's commands must see the TAG. Empty means the ref that
    // started the run, which is what `actions/checkout` does when given no `ref`.
    new ActionsCheckoutV4({
      name: "Checkout the tree this deployment ships",
      with: { ref: "${{ matrix.ref }}" },
    }),
    new SetupBunAction({ name: "Setup Bun" }),
    environmentSetupStep(),
    runStep,
  ],
);

/**
 * Start a deploy run for each tag the deployments above created.
 *
 * A deployment that cuts a release creates its tag with GITHUB_TOKEN, and GitHub
 * starts no workflow run for its own token's events — so `on_tag` never fired for a
 * project's own release tags. The run that made the tag is the only thing that knows
 * it is new, so that run dispatches. `scripts/dispatch_new_tags.ts` has the whole
 * argument, including why this is a job of its own: dispatching needs
 * `actions: write`, and the job that runs a project's deployment commands must not
 * have it.
 *
 * Skipped when `tags_before` is empty, which is how the planning job says there is
 * nothing to watch for — no `on_tag` entry, nothing deploying, or a run that was
 * itself started by a tag and so must not start another.
 *
 * Skipped too when a deployment failed. Fail-fast already stopped the rest, and a
 * tag from a run that did not finish is not one to build on.
 */
const dispatchNewTagsJob = new DefinedJob(
  DISPATCH_TAGS_JOB,
  {
    needs: [planJob, deployJob],
    if: JobCondition.isNot(planJob.rawOutputs.tags_before, "").and(
      JobCondition.is(deployJob.rawResult, "success"),
    ),
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    // The one job here that may start a workflow, and it runs nothing a project
    // wrote. `contents: read` is for the checkout that brings the script.
    permissions: { contents: "read", actions: "write" },
  },
  [
    new ActionsCheckoutV4({
      name: "Checkout the default branch, for the script",
      with: { ref: "${{ github.event.repository.default_branch }}" },
    }),
    new SetupBunAction({ name: "Setup Bun" }),
    new TypedOutputsStep({
      name: "Deploy any tag these deployments created",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        ATOMATON_REPO: "${{ github.repository }}",
        // Read from here rather than passed as an argument: it is a list, and a
        // repository with five hundred tags would otherwise be a five-hundred
        // element argv. See the script.
        [TAGS_BEFORE_VAR]: `\${{ needs.${PLAN_JOB}.outputs.tags_before }}`,
      },
      run: `${scriptCommandWithArgs(dispatchNewTagsRef, { repo: "${ATOMATON_REPO}" })}\n`,
    }),
  ],
);

export const atomaDeploy = new Workflow("atomaton-deploy", {
  name: "Atomaton Deploy",
  on: {
    workflow_dispatch: {
      inputs: {
        target: {
          description:
            "Name of the deployment to run, as written under `deploy` in config.yaml. " +
            "Leaving it empty deploys nothing.",
          required: false,
          type: "string",
          default: "",
        },
        trigger: {
          // Shown to a person, because `workflow_dispatch` shows every input. Its
          // default is the safe one, so a human who leaves it alone gets what leaving
          // it alone should mean.
          description: "Leave this alone. Atomaton sets it when it starts this workflow itself.",
          required: false,
          type: "string",
          default: "demand",
        },
      },
    },
    // Every tag and every branch, filtered by `deploy` at run time -- see above.
    //
    // `**`, not `*`. This filter is meant to start the run for every ref and let
    // `plan_deploy.ts` decide whether any entry wanted that one -- but GitHub's `*`
    // does not cross `/`, so a validated `tags: ["release/*"]` entry never started a
    // run at all, and `branches: ["feature/*"]` would not either. `**` matches the
    // separator too.
    push: { tags: ["**"], branches: ["**"] },
  } as unknown as GWT.Workflow["on"],
  // Deployments queue rather than cancel. Cancelling one half way through leaves the
  // target in a state nobody chose, which is worse than waiting. At the workflow
  // level rather than the job's, because the job is a matrix now: a group evaluated
  // per entry would have the entries queueing behind each other, which is what
  // `max-parallel` is for and not what this is for.
  concurrency: { group: "atomaton-deploy-${{ github.ref }}", "cancel-in-progress": false },
  permissions: { contents: "read" },
} as unknown as GWT.Workflow).addJobs([planJob, deployJob, dispatchNewTagsJob]);

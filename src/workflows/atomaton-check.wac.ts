import { Workflow, type GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";
import { ActionsCheckoutV4 } from "@github-actions-workflow-ts/actions";
import { DefinedJob, JobCondition, TypedOutputsStep } from "./actions/base.ts";
import { COMMANDS_VAR, matrixJob, matrixSecretEnv, RUN_DECLARED_COMMANDS } from "./actions/declared-job.ts";
import { MACHINERY_ROOT, scriptCommandWithArgs } from "./actions/script-call.ts";
import { scriptCommand } from "./actions/script-call.ts";
import { ATOMA_DEFAULT_VERSION, installAtomaCliStep } from "./actions/atoma-cli.ts";
import { renameSecretSlots } from "./actions/secret-slots.ts";
import { SetupBunAction } from "./actions/third-party.ts";
import { environmentSetupStep } from "./actions/environment-setup.ts";
import { ref as checkLiveToolsRef } from "../entrypoints/machinery/check_live_tools.ts";
import { ref as planChecksRef } from "../entrypoints/machinery/plan_checks.ts";

// Runs whatever config.yaml's `checks` says verifies this project.
//
// It exists so that a project's verification is something an agent can write.
// GITHUB_TOKEN is refused on `.github/workflows/**` by identity -- on every path
// and every branch, measured -- so an agent asked to set up CI for a new
// repository cannot author a workflow. It can author configuration, and this
// workflow is the fixed shell that runs it. Nothing here changes per project;
// everything that does lives in config.yaml.
//
// A repository that already has CI does not need this: name that workflow in
// `checks.your_workflow` instead, and the jobs say so and pass rather than failing
// over an empty list. The two are alternatives -- declaring both is a configuration
// error, not a precedence rule.
//
// ## Two arms, and why each is a matrix
//
// `checks.from_pull_request` runs the commands the pull request declares, in its own
// tree. `checks.from_default_branch` runs the default branch's commands with the pull
// request handed over as a path to read. Which arm a check belongs in is decided by
// whose commands run, and that decides whether it may name a secret -- see
// `domain/delivery/declared-jobs.ts`.
//
// Both are matrices, one GitHub job per declared check. The credentialed arm has to
// be, so a secret reaches the one check that named it. The pull request's arm was a
// single job until the same question was asked of it: splitting it buys a per-check
// runner, parallelism, and a failure that names itself, and the only reason it was
// not split was that its checks have no secrets to keep apart.
//
// ## Two triggers, because the two kinds of pull request arrive differently
//
// An agent's pull request is opened with GITHUB_TOKEN, and GitHub starts no
// workflow run for its own token's events -- so `pull_request` never fires for
// it. `validate_pull_request.ts` dispatches this workflow instead and mirrors the
// result onto the head commit where a ruleset can see it.
//
// A person's pull request does fire `pull_request`, and nothing was dispatching
// this workflow for one. Since this is what `checks.your_workflow` defaults to, that
// left a repository with no CI at all for its human contributors -- a required check
// that never ran, and a merge refused for a missing check until someone dispatched it
// by hand. So `pull_request` is listed too, and it is inert for the agent case by the
// same rule that made it necessary for the human one.

/** The name a required status check refers to. Pinned to the shipped ruleset by a contract test. */
export const CHECK_JOB_NAME = "atomaton-check";

/** One matrix entry per `checks.from_pull_request`. */
const PULL_REQUEST_JOB_NAME = "pull-request-checks";
/** One matrix entry per `checks.from_default_branch`, each with only its own secrets. */
const DEFAULT_BRANCH_JOB_NAME = "default-branch-checks";
/** Atomaton's own check, which is nobody's configuration to remove. */
const TOOLS_JOB_NAME = "atomaton-tools";

/** Publishes each matrix. Separate jobs, because `strategy` is read before any step runs. */
const PLAN_PULL_REQUEST_JOB = "plan-pull-request-checks";
const PLAN_DEFAULT_BRANCH_JOB = "plan-default-branch-checks";
const PLAN_STEP_ID = "plan";

/** Where the pull request is put for a default-branch command to read. */
const PR_TREE_DIR = ".atomaton-pull-request";

/**
 * A job that reads one arm and publishes it as a matrix.
 *
 * Two of these rather than one, and the difference is the checkout: an arm is planned
 * from the tree whose commands it names. The pull request may choose its own checks
 * freely, because no secret reaches them. It may not choose which credential reaches
 * which job, so that arm is read from the default branch.
 */
function planJob(
  jobName: string,
  arm: "pull-request" | "default-branch",
  checkout: ActionsCheckoutV4,
  run: string,
): DefinedJob<{ jobs: string }> {
  return new DefinedJob<{ jobs: string }>(
    jobName,
    {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 5,
      permissions: { contents: "read" },
      outputs: { jobs: `\${{ steps.${PLAN_STEP_ID}.outputs.jobs }}` },
    },
    [
      checkout,
      new SetupBunAction({ name: "Setup Bun" }),
      new TypedOutputsStep({ name: `Read \`checks.from_${arm.replace("-", "_")}\``, id: PLAN_STEP_ID, shell: "bash", run }),
    ],
  );
}

const planPullRequestChecksJob = planJob(
  PLAN_PULL_REQUEST_JOB,
  "pull-request",
  new ActionsCheckoutV4({ name: "Checkout the pull request, whose commands these are" }),
  `${scriptCommandWithArgs(planChecksRef, { arm: "pull-request" })}\n`,
);

const planDefaultBranchChecksJob = planJob(
  PLAN_DEFAULT_BRANCH_JOB,
  "default-branch",
  new ActionsCheckoutV4({
    name: "Checkout the default branch, which decides what may hold a credential",
    with: { ref: "${{ github.event.repository.default_branch }}" },
  }),
  // The default branch may predate this script, and says so rather than answering as
  // though it had looked. It happens once, in the repository that builds the
  // deliverable: the workflow and the script arrive in one release for everyone else,
  // but here the pull request carrying both is checked by a default branch that has
  // neither yet.
  //
  // `[]` is what it publishes, because there is nothing to run and the job that
  // collects verdicts reads a skipped matrix as a pass. The warning is what keeps that
  // from being silent: an empty answer and an unaskable question look identical
  // afterwards, and only one of them is a project with no such check.
  [
    `PLANNER="${MACHINERY_ROOT}/${planChecksRef.runtimePath}"`,
    'if [ ! -f "$PLANNER" ]; then',
    '  echo "::warning::$PLANNER is not on the default branch yet, so no credentialed check could be planned. This is expected once, on the change that adds it."',
    `  echo "jobs=[]" >> "\$GITHUB_OUTPUT"`,
    "  exit 0",
    "fi",
    `bun run "\$PLANNER" --arm default-branch`,
    "",
  ].join("\n"),
);

/**
 * Checks routinely need a token: `gh` for anything, a package manager reaching a
 * registry that authenticates with it, a submodule. Without one a project's commands
 * are the only ones in the system that cannot talk to GitHub, and the failure reads as
 * a broken command rather than a missing token.
 *
 * It grants no more than the job already holds. `contents: read` is what the checkout
 * used, so on a public repository this is what any visitor has, and on a private one it
 * is what the code being tested was fetched with.
 */
const CHECK_ENV = {
  [COMMANDS_VAR]: "${{ toJSON(matrix.commands) }}",
  GH_TOKEN: "${{ github.token }}",
};

/**
 * The pull request's own commands, and a step with nowhere to put a credential.
 *
 * Two steps rather than one shared by both arms, and the duplication is the point.
 * A single step carrying the secret slots would have held them empty here, because
 * `from_pull_request` entries cannot name a secret — which makes the guarantee "the
 * list happens to be empty" instead of "there is nowhere to write one". The first is
 * a fact about today's configuration; the second is a property of the workflow, and it
 * is the one `reserved-names.test.ts` holds this to.
 */
function runPullRequestChecks() {
  return new TypedOutputsStep({
    name: "Run this check's commands",
    shell: "bash",
    env: CHECK_ENV,
    run: RUN_DECLARED_COMMANDS,
  });
}

/**
 * The default branch's commands, each job handed the secrets its own entry named.
 *
 * The pull request is here as a path to read — `$ATOMATON_PR_TREE` — under the rule
 * `validate_deliverable.ts` states about `--root`: data, never code.
 */
function runCredentialledChecks() {
  return new TypedOutputsStep({
    name: "Run this check's commands",
    shell: "bash",
    env: {
      ...matrixSecretEnv(),
      ATOMATON_PR_TREE: `\${{ github.workspace }}/${PR_TREE_DIR}`,
      ...CHECK_ENV,
    },
    run: renameSecretSlots() + "\n" + RUN_DECLARED_COMMANDS,
  });
}
/** One check's problem should not hide another's, so neither arm stops at the first. */
const CHECK_MATRIX = { timeoutMinutes: 30, failFast: false, permissions: { contents: "read" } } as const;

const pullRequestChecksJob = matrixJob(PULL_REQUEST_JOB_NAME, planPullRequestChecksJob, CHECK_MATRIX, [
  new ActionsCheckoutV4({ name: "Checkout the pull request" }),
  new SetupBunAction({ name: "Setup Bun" }),
  environmentSetupStep(),
  runPullRequestChecks(),
]);

const defaultBranchChecksJob = matrixJob(DEFAULT_BRANCH_JOB_NAME, planDefaultBranchChecksJob, CHECK_MATRIX, [
  new ActionsCheckoutV4({
    name: "Checkout the default branch, whose commands these are",
    with: { ref: "${{ github.event.repository.default_branch }}" },
  }),
  new ActionsCheckoutV4({ name: "Checkout the pull request, as data", with: { path: PR_TREE_DIR } }),
  new SetupBunAction({ name: "Setup Bun" }),
  runCredentialledChecks(),
]);

/**
 * Atomaton's own check: start the tool servers this repository's agents would use and
 * ask what they offer, so a guard that has stopped guarding fails here rather than
 * going unnoticed.
 *
 * Its own job rather than a step in the pull request's matrix, and the reason is the
 * matrix: it would otherwise run once per declared check, installing the CLI each
 * time, to ask a question that has one answer. It is also not the project's check --
 * `validate_deliverable.ts` is separate for the same reason. A project that could
 * delete it would be a project that can stop being told.
 *
 * It may start what the pull request declares because this job holds nothing worth
 * taking: no repository secret reaches it.
 */
const toolsJob = new DefinedJob(
  TOOLS_JOB_NAME,
  {
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 30,
    permissions: { contents: "read" },
  },
  [
    new ActionsCheckoutV4({ name: "Checkout the pull request" }),
    new SetupBunAction({ name: "Setup Bun" }),
    environmentSetupStep(),
    installAtomaCliStep(ATOMA_DEFAULT_VERSION),
    new TypedOutputsStep({
      name: "Check the tool servers against their guards",
      shell: "bash",
      run: `${scriptCommand(checkLiveToolsRef)}\n`,
    }),
  ],
);

/**
 * The one job a ruleset names, and all it does is agree with the jobs before it.
 *
 * A required context has to be a fixed string, and the jobs doing the work are not:
 * a matrix entry is reported as `default-branch-checks (cloud-names)`. A required
 * context that stops existing is not a check that fails — it is every pull request
 * waiting on a name nothing reports, and an administrator is needed to undo it. So
 * the name lives here, where nothing can rename it.
 *
 * `if: always()`, because a job skipped by a failed dependency reports nothing, which
 * a required check cannot distinguish from success that has not arrived yet. The
 * verdict is read from the results instead, and `skipped` is a pass: it is what an
 * empty matrix produces, and an empty matrix is a project that declared no such
 * check rather than a check that did not run.
 */
export const checkResultJob = new DefinedJob(
  CHECK_JOB_NAME,
  {
    needs: [pullRequestChecksJob, defaultBranchChecksJob, toolsJob],
    if: JobCondition.always(),
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    permissions: { contents: "read" },
  },
  [
    new TypedOutputsStep({
      name: "Report the verdict of every check job",
      shell: "bash",
      env: {
        PULL_REQUEST_RESULT: `\${{ needs.${PULL_REQUEST_JOB_NAME}.result }}`,
        DEFAULT_BRANCH_RESULT: `\${{ needs.${DEFAULT_BRANCH_JOB_NAME}.result }}`,
        TOOLS_RESULT: `\${{ needs.${TOOLS_JOB_NAME}.result }}`,
      },
      run: [
        'echo "the pull request\'s own commands: $PULL_REQUEST_RESULT"',
        'echo "the default branch\'s commands:   $DEFAULT_BRANCH_RESULT"',
        'echo "Atomaton\'s own tool check:        $TOOLS_RESULT"',
        'for result in "$PULL_REQUEST_RESULT" "$DEFAULT_BRANCH_RESULT" "$TOOLS_RESULT"; do',
        '  case "$result" in',
        "    success|skipped) ;;",
        '    *) echo "::error::a check job reported \'$result\'"; exit 1 ;;',
        "  esac",
        "done",
        "",
      ].join("\n"),
    }),
  ],
);

export const atomaCheck = new Workflow("atomaton-check", {
  name: "Atomaton Check",
  on: {
    workflow_dispatch: {},
    // The default set, written out: a person's pull request when it opens, when
    // it is pushed to, and when it comes back from closed. Marking a draft ready
    // changes no code, so the check already on that commit still stands.
    pull_request: { types: ["opened", "synchronize", "reopened"] },
  } as unknown as GWT.Workflow["on"],
  // Reading the repository and running commands in it. Nothing here writes to
  // GitHub: the check run a ruleset reads is written by atomaton-validate-pr, which
  // holds `checks: write` for that one purpose.
  permissions: { contents: "read" },
}).addJobs([
  planPullRequestChecksJob,
  planDefaultBranchChecksJob,
  pullRequestChecksJob,
  defaultBranchChecksJob,
  toolsJob,
  checkResultJob,
]);

import { Workflow, type GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";
import { ActionsCheckoutV4 } from "@github-actions-workflow-ts/actions";
import { DefinedJob, TypedOutputsStep } from "./actions/base.ts";
import { pickRunnerJob, PICK_RUNNER_JOB } from "./actions/pick-runner.ts";
import { scriptCommand } from "./actions/script-call.ts";
import { ATOMA_DEFAULT_VERSION, installAtomaCliStep } from "./actions/atoma-cli.ts";
import { renameSecretSlots } from "./actions/secret-slots.ts";
import { SECRET_SLOT_PREFIX, SECRET_SLOTS } from "../domain/declared-secrets.ts";
import { SetupBunAction } from "./actions/third-party.ts";
import { environmentSetupStep } from "./actions/environment-setup.ts";
import { ref as runChecksRef } from "../scripts/run_checks.ts";
import { ref as checkLiveToolsRef } from "../scripts/check_live_tools.ts";
import { ref as planDefaultBranchChecksRef } from "../scripts/plan_default_branch_checks.ts";

// Runs whatever config.yaml's `checks.atomaton_runs.commands` says verifies this project.
//
// It exists so that a project's verification is something an agent can write.
// GITHUB_TOKEN is refused on `.github/workflows/**` by identity -- on every path
// and every branch, measured -- so an agent asked to set up CI for a new
// repository cannot author a workflow. It can author configuration, and this
// workflow is the fixed shell that runs it. Nothing here changes per project;
// everything that does lives in config.yaml.
//
// A repository that already has CI does not need this: name that workflow in
// `checks.your_workflow` instead of filling in `checks.atomaton_runs`, and the job
// says so and passes rather than failing over an empty list. The two are
// alternatives -- declaring both is a configuration error, not a precedence rule.
//
// Two triggers, because the two kinds of pull request arrive differently.
//
// An agent's pull request is opened with GITHUB_TOKEN, and GitHub starts no
// workflow run for its own token's events -- so `pull_request` never fires for
// it. `validate_pull_request.ts` dispatches this workflow instead and mirrors the
// result onto the head commit where a ruleset can see it.
//
// A person's pull request does fire `pull_request`, and nothing was dispatching
// this workflow for one. Since this is what `checks.your_workflow` defaults to, that left
// a repository with no CI at all for its human contributors -- a required check
// that never ran, and a merge refused for a missing check until someone
// dispatched it by hand. So `pull_request` is listed too, and it is inert for the
// agent case by the same rule that made it necessary for the human one.

/** The name a required status check refers to. Pinned to the shipped ruleset by a contract test. */
export const CHECK_JOB_NAME = "atomaton-check";

/** Runs the pull request's own commands. Renameable; the required context is not. */
const PULL_REQUEST_JOB_NAME = "pull-request-checks";

/** One matrix entry per `checks.default_branch_runs.jobs`, each with only its own secrets. */
const DEFAULT_BRANCH_JOB_NAME = "default-branch-checks";

/** Publishes that matrix. Separate because `strategy` is read before any step runs. */
const PLAN_JOB_NAME = "plan-default-branch-checks";
const PLAN_STEP_ID = "plan";

/** Where the pull request is put for a default-branch command to read. */
const PR_TREE_DIR = ".atomaton-pull-request";


const runStep = new TypedOutputsStep({
  name: "Run the configured checks",
  shell: "bash",
  env: {
    // Checks routinely need one: `gh` for anything, a package manager reaching a
    // registry that authenticates with it, a submodule. Without it a project's
    // commands are the only ones in the system that cannot talk to GitHub, and
    // the failure reads as a broken command rather than a missing token.
    //
    // It grants no more than the job already holds. `contents: read` is what the
    // checkout used, so on a public repository this is what any visitor has, and
    // on a private one it is what the code being tested was fetched with.
    //
    // And it is the ONLY credential here. A repository secret used to reach this
    // step through `checks.atomaton_runs.secrets`, into a step running commands the
    // pull request itself declares -- so the trusted side chose which credential to
    // hand over and the untrusted side chose what to do with it. The section is
    // `checks.pull_request_runs` now, and it has nowhere to name a secret.
    GH_TOKEN: "${{ github.token }}",
  },
  run: `${scriptCommand(runChecksRef)}
`,
});

/**
 * Starts the tool servers this repository's agents would use and asks what they
 * offer, so a guard that has stopped guarding fails here rather than going unnoticed.
 *
 * A built-in step rather than a default in `commands`, because it is not the
 * project's check: it asks whether Atomaton's own wiring still holds in this tree.
 * `validate_deliverable.ts` is there for the same reason. A project that could
 * delete it would be a project that can stop being told.
 *
 * It may start what the pull request declares because this job holds nothing worth
 * taking: its commands are already the pull request's own, and no repository secret
 * reaches them. The half that holds credentials runs the default branch's commands
 * instead, and is not built yet.
 */
const liveToolsStep = new TypedOutputsStep({
  name: "Check the tool servers against their guards",
  shell: "bash",
  run: `${scriptCommand(checkLiveToolsRef)}
`,
});


/**
 * Publishes the credentialed check jobs, read from the DEFAULT BRANCH's config.
 *
 * Its own job, because `strategy.matrix` is evaluated before any step of the job
 * it belongs to — the list has to already be an output by then. `pick-runner` is
 * here for the same reason and reads the pull request's config instead, which is
 * the difference that matters: a runner label is the pull request's to choose, and
 * which credential reaches which job is not.
 */
const planDefaultBranchChecksJob = new DefinedJob<{ jobs: string }>(
  PLAN_JOB_NAME,
  {
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    permissions: { contents: "read" },
    outputs: { jobs: `\${{ steps.${PLAN_STEP_ID}.outputs.jobs }}` },
  },
  [
    new ActionsCheckoutV4({
      name: "Checkout the default branch, which decides what may hold a credential",
      with: { ref: "${{ github.event.repository.default_branch }}" },
    }),
    new SetupBunAction({ name: "Setup Bun" }),
    new TypedOutputsStep({
      name: "Read the credentialed checks this project declares",
      id: PLAN_STEP_ID,
      shell: "bash",
      // The default branch may predate this script, and says so rather than
      // answering as though it had looked. It happens once, in the repository that
      // builds the deliverable: the workflow and the script arrive in one release
      // for everyone else, but here the pull request carrying both is checked by a
      // default branch that has neither yet.
      //
      // `[]` is what it publishes, because there is nothing to run and the job that
      // collects verdicts reads a skipped matrix as a pass. The warning is what keeps
      // that from being silent: an empty answer and an unaskable question look
      // identical afterwards, and only one of them is a project with no such check.
      run: [
        `PLANNER="\${ATOMATON_MACHINERY_ROOT:-.}/${planDefaultBranchChecksRef.runtimePath}"`,
        'if [ ! -f "$PLANNER" ]; then',
        '  echo "::warning::$PLANNER is not on the default branch yet, so no credentialed check could be planned. This is expected once, on the change that adds it."',
        `  echo "jobs=[]" >> "\$GITHUB_OUTPUT"`,
        "  exit 0",
        "fi",
        `bun run "\$PLANNER"`,
        "",
      ].join("\n"),
    }),
  ],
);

/**
 * The credentialed half, one GitHub job per declared check.
 *
 * The matrix comes from a job output because a workflow cannot read a file to decide
 * its own jobs — the same reason `pick-runner` exists. What that buys here is least
 * privilege: each entry names its own secrets, and GitHub hands a job only the ones
 * its own entry named. Measured before relying on it: three entries, three different
 * declarations, and each job saw exactly what it had asked for.
 *
 * Two checkouts, and the order is the whole security property. The DEFAULT BRANCH is
 * checked out into the workspace, because these commands are the ones a pull request
 * must not choose. The pull request goes into a subdirectory and is handed over as
 * `ATOMATON_PR_TREE`: a path to read, under the same rule `validate_deliverable.ts`
 * states about `--root`. Nothing mechanical stops a default-branch command from
 * executing what it was given — an interpreter reads a file rather than executing it,
 * so `noexec` would not help — which is why this list is meant to stay short enough
 * to review.
 */
const defaultBranchChecksJob = new DefinedJob(
  DEFAULT_BRANCH_JOB_NAME,
  {
    needs: [PLAN_JOB_NAME],
    // Nothing to run is not a failure: a project with no credentialed check declares
    // an empty list, and the job that collects the verdicts reads `skipped` as a pass.
    if: `\${{ needs.${PLAN_JOB_NAME}.outputs.jobs != '[]' }}`,
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 30,
    permissions: { contents: "read" },
    strategy: {
      // One job's credential problem should not hide another's.
      "fail-fast": false,
      matrix: { include: `\${{ fromJSON(needs.${PLAN_JOB_NAME}.outputs.jobs) }}` },
    },
  } as unknown as GWT.NormalJob,
  [
    new ActionsCheckoutV4({
      name: "Checkout the default branch, whose commands these are",
      with: { ref: "${{ github.event.repository.default_branch }}" },
    }),
    new ActionsCheckoutV4({
      name: "Checkout the pull request, as data",
      with: { path: PR_TREE_DIR },
    }),
    new SetupBunAction({ name: "Setup Bun" }),
    new TypedOutputsStep({
      name: "Run this check's commands",
      shell: "bash",
      env: {
        // Each slot is keyed by a name this matrix entry declared, so a job is handed
        // its own credentials and no others. An entry naming fewer than the maximum
        // leaves the rest empty, which is what an unset secret looks like anyway.
        ...Object.fromEntries(
          Array.from({ length: SECRET_SLOTS }, (_, slot) => [
            `${SECRET_SLOT_PREFIX}${slot}`,
            `\${{ secrets[matrix.secrets[${slot}]] }}`,
          ]),
        ),
        ATOMATON_SECRET_NAMES: "${{ toJSON(matrix.secrets) }}",
        ATOMATON_CHECK_COMMANDS: "${{ toJSON(matrix.commands) }}",
        ATOMATON_PR_TREE: `\${{ github.workspace }}/${PR_TREE_DIR}`,
      },
      run: [
        renameSecretSlots(),
        'echo "$ATOMATON_CHECK_COMMANDS" | jq -r ".[]" | while IFS= read -r command; do',
        '  echo "::group::$command"',
        '  if ! bash -c "$command"; then',
        '    echo "::endgroup::"',
        '    echo "::error::${{ matrix.name }}: $command"',
        "    exit 1",
        "  fi",
        '  echo "::endgroup::"',
        "done",
        "",
      ].join("\n"),
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
    needs: [PULL_REQUEST_JOB_NAME, DEFAULT_BRANCH_JOB_NAME],
    if: "always()",
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
      },
      run: [
        'echo "the pull request\'s own commands: $PULL_REQUEST_RESULT"',
        'echo "the default branch\'s commands:   $DEFAULT_BRANCH_RESULT"',
        'for result in "$PULL_REQUEST_RESULT" "$DEFAULT_BRANCH_RESULT"; do',
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
  ...pickRunnerJob("checks").then((pick) =>
    new DefinedJob(
      PULL_REQUEST_JOB_NAME,
      {
        needs: [pick.name],
        // From `checks.pull_request_runs.runs_on`, via the job above -- `runs-on`
        // cannot read a file. `fromJSON` always, so one label and a self-hosted
        // runner's several are consumed the same way. See `domain/runner-label.ts`.
        "runs-on": `\${{ fromJSON(needs.${PICK_RUNNER_JOB}.outputs.runs_on) }}` as unknown as string,
        // Long enough for a real test suite, short enough that a hung command does
        // not hold a runner all day.
        "timeout-minutes": 30,
        // One verification per ref at a time; a second push supersedes the first,
        // whose verdict is already stale.
        concurrency: {
          group: `atomaton-check-\${{ github.ref }}`,
          "cancel-in-progress": true,
        },
        permissions: { contents: "read" },
      },
      [
        new ActionsCheckoutV4({ name: "Checkout repository" }),
        new SetupBunAction({ name: "Setup Bun" }),
        environmentSetupStep(),
        runStep,
        installAtomaCliStep(ATOMA_DEFAULT_VERSION),
        liveToolsStep,
      ],
    ),
  ).jobs(),
  planDefaultBranchChecksJob,
  defaultBranchChecksJob,
  checkResultJob,
]);

import { Workflow } from "@github-actions-workflow-ts/lib";
import type { IssuesClosedEvent } from "@octokit/webhooks-types";
import { ActionsCheckoutV4 } from "@github-actions-workflow-ts/actions";
import { DefinedJob, JobCondition, startJob, TypedOutputsStep } from "./actions/base.ts";
import { githubEvent, githubEventRaw, isRepositoryMember } from "./actions/github-context.ts";
import { ATOMATON_WORKFLOW_PERMISSIONS } from "./actions/permissions.ts";
import { scriptCommand, scriptCommandWithArgs } from "./actions/script-call.ts";
import { SetupBunAction } from "./actions/third-party.ts";
import { ref as dispatchIfSiblingsDoneRef } from "../entrypoints/machinery/dispatch_if_siblings_done.ts";
import { ref as checkSubIssueClosureRef } from "../entrypoints/machinery/check_sub_issue_closure.ts";
import { ref as pruneAtomaDataRef } from "../entrypoints/machinery/prune_atomaton_data.ts";
import { ref as stopOnCloseRef } from "../entrypoints/machinery/stop_on_close.ts";

// FALLBACK for manually closed sub-issues.
// Primary aggregation happens in atomaton-pr-merged.wac.ts (pull_request_target).
// This handles the case where a human closes a sub-issue manually.
//
// Job graph:
//   check --> aggregate
//   prune            (independent; every closed issue, not only sub-issues)
//   stop-run         (independent; a person closing an issue an agent is working on)
//
// `stop-run` rides on this event for the same reason `prune` does: closing is the
// moment the question becomes askable, so the trigger and the condition are one thing.
// It is not about sub-issues either, and depends on nothing above it.

// Pruning rides on this event rather than on a schedule, because closing an issue is
// the moment its stored session becomes dead -- so the trigger and the condition are
// the same thing, and a cron would only be a worse approximation of it that also has
// to exist as a workflow of its own. Anything a run misses is picked up the next time
// any issue closes, which is why this needs no catch-up pass.
//
// It does not depend on `check`: that job answers a question about sub-issues, and a
// root issue's session is just as dead.
const pruneStep = new TypedOutputsStep(
  {
    name: "Prune stored data for issues that are over",
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
    },
    run: `${scriptCommand(pruneAtomaDataRef)}\n`,
  },
  [] as const,
);

/**
 * A person closed an issue an agent is working on, so the run is asked to stop.
 *
 * Gated on the closer being a person. An agent closing the issue it is working on is
 * a normal path -- `domain/machinery/atomaton-data-pruning.ts` is built around it -- and
 * stopping that run would cut it off in the middle of finishing. The script checks
 * the in-progress label and does nothing when no run holds it, so this job is cheap
 * on the ordinary close.
 */
const stopOnCloseStep = new TypedOutputsStep(
  {
    name: "Stop the run this close did not stop",
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      NUMBER: githubEvent<IssuesClosedEvent>((e) => e.issue.number),
      CLOSER: githubEvent<IssuesClosedEvent>((e) => e.sender.login),
      CLOSER_TYPE: githubEvent<IssuesClosedEvent>((e) => e.sender.type),
    },
    run: `${scriptCommandWithArgs(stopOnCloseRef, {
      number: "\${NUMBER}",
      closer: "\${CLOSER}",
      "closer-type": "\${CLOSER_TYPE}",
    })}
`,
  },
  [] as const,
);

const checkStep = new TypedOutputsStep(
  {
    name: "Check sub-issue closure (native parent link + already-handled-via-PR?)",
    id: "check",
    shell: "bash",
    env: {
      CLOSED_NUM: githubEvent<IssuesClosedEvent>((e) => e.issue.number),
      GH_TOKEN: "${{ github.token }}",
      OWNER: "${{ github.repository_owner }}",
      REPO: githubEvent<IssuesClosedEvent>((e) => e.repository.name),
    },
    run: `${scriptCommand(checkSubIssueClosureRef)}\n`,
  },
  ["is_sub_issue", "parent_number", "closed_via_pr"] as const,
);

export const atomaSubIssueClosed = new Workflow("atomaton-sub-issue-closed", {
  name: "Atomaton Sub-Issue Closed",
  on: {
    issues: { types: ["closed"] },
  },
  permissions: ATOMATON_WORKFLOW_PERMISSIONS,
}).addJobs(
  startJob(
    "check",
    {
      "runs-on": "ubuntu-latest",
      // Only a repository member closing an issue triggers parent aggregation.
      if: JobCondition.from(isRepositoryMember(githubEventRaw<IssuesClosedEvent>((e) => e.issue.author_association))),
      outputs: {
        is_sub_issue: checkStep.outputs.is_sub_issue,
        parent_number: checkStep.outputs.parent_number,
        closed_via_pr: checkStep.outputs.closed_via_pr,
      },
    },
    [new ActionsCheckoutV4({}), new SetupBunAction({ name: "Setup Bun" }), checkStep],
  )
    .then(
      (checkJob) =>
        new DefinedJob(
          "aggregate",
          {
            "runs-on": "ubuntu-latest",
            if: JobCondition.is(checkJob.rawOutputs.is_sub_issue, "true").and(
              JobCondition.isNot(checkJob.rawOutputs.closed_via_pr, "true"),
            ),
            needs: [checkJob],
          },
          [
            new ActionsCheckoutV4({}),
            new SetupBunAction({ name: "Setup Bun" }),
            new TypedOutputsStep({
              name: "Check siblings and re-trigger atomaton",
              shell: "bash",
              env: {
                GH_TOKEN: "${{ github.token }}",
                OWNER: "${{ github.repository_owner }}",
                REPO: githubEvent<IssuesClosedEvent>((e) => e.repository.name),
                PARENT: checkJob.outputs.parent_number,
                CLOSED_NUM: githubEvent<IssuesClosedEvent>((e) => e.issue.number),
              },
              run: `${scriptCommandWithArgs(dispatchIfSiblingsDoneRef, { repo: "\${OWNER}/\${REPO}", parent: "\${PARENT}", "closed-num": "\${CLOSED_NUM}" })}
`,
            }),
          ],
        ),
    )
    .jobs()
    .concat([
      new DefinedJob(
        "stop-run",
        {
          "runs-on": "ubuntu-latest",
          if: JobCondition.isNot(githubEventRaw<IssuesClosedEvent>((e) => e.sender.type), "Bot"),
        },
        [new ActionsCheckoutV4({}), new SetupBunAction({ name: "Setup Bun" }), stopOnCloseStep],
      ),
      new DefinedJob("prune", { "runs-on": "ubuntu-latest" }, [
        new ActionsCheckoutV4({}),
        new SetupBunAction({ name: "Setup Bun" }),
        pruneStep,
      ]),
    ]),
);

import { Workflow } from "@github-actions-workflow-ts/lib";
import type { IssueCommentCreatedEvent } from "@octokit/webhooks-types";
import { ActionsCheckoutV4 } from "@github-actions-workflow-ts/actions";
import { startJob, TypedOutputsStep } from "./actions/base.ts";
import { githubEvent, githubEventRaw, isRepositoryMember } from "./actions/github-context.ts";
import { ATOMATON_WORKFLOW_PERMISSIONS } from "./actions/permissions.ts";
import { scriptCommand, scriptCommandWithArgs } from "./actions/script-call.ts";
import { SetupBunAction } from "./actions/third-party.ts";
import { dispatchToAtomaRunner } from "./atomaton-runner.wac.ts";
import { ref as parseCommentCommandRef } from "../entrypoints/machinery/parse_comment_command.ts";
import { ref as guardCommentRef } from "../entrypoints/machinery/guard_comment_during_run.ts";
import { ref as guardCommandOnClosedRef } from "../entrypoints/machinery/guard_command_on_closed.ts";
import { ref as requestStopRef } from "../entrypoints/machinery/request_stop.ts";
import { ref as resolveResumeAgentRef } from "../entrypoints/machinery/resolve_resume_agent.ts";
import { ref as resumeSubtreeRef } from "../entrypoints/machinery/resume_subtree.ts";
import { ref as dispatchPrValidationRef } from "../entrypoints/machinery/dispatch_pr_validation.ts";
import { LLM_CONTEXT_TAG } from "../adapters/github/tags.ts";

// Invoke agents via /agent-name slash command in issue/PR comments.
// Slash-command DISPATCH is restricted to OWNER/MEMBER/COLLABORATOR (see
// parseCommandStep's own `if:` below), but the in-progress GUARD (see
// guardStep) runs for every human comment regardless of association --
// nobody's comment should sit unseen (or race a dispatch) while an Atomaton
// run is actively working on this issue/PR.
//
// Job graph:
//   parse --> run (atomaton-runner.yml, reusable)

// Bot comments are never guarded (Atomaton's own comments, e.g. dispatch
// confirmations, must never be self-deleted) -- only ever relevant for a
// human-authored comment.
const IS_HUMAN_COMMENT = `${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.user.type)} != 'Bot'`;


// A slash command dispatches only for a repository member, or for Atomaton's own
// dispatch marker. The membership half now shares `isRepositoryMember` with every
// other entry point, so the trust boundary has one definition rather than an
// inline expression here and nothing anywhere else.
//
// The job itself still runs for non-qualifying humans, but only so guardStep can
// do its job; this step refuses to parse or dispatch for them.
const PARSE_ALLOWED =
  `(${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.user.type)} == 'Bot' &&\n` +
  ` contains(${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.body)}, 'atomaton:dispatch')) ||\n` +
  `(${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.user.type)} != 'Bot' &&\n` +
  ` ${isRepositoryMember(githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.author_association))})`;

const parseCommandStep = new TypedOutputsStep(
  {
    name: "Parse slash command",
    id: "command",
    // No longer conditioned on the guard, because the guard now reads this step. What
    // the guard suppresses is the dispatch, which is what it was protecting all along
    // -- see `dispatchStep`.
    if: PARSE_ALLOWED,
    shell: "bash",
    env: {
      ATOMATON_COMMENT_BODY: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.body),
    },
    run: `${scriptCommand(parseCommentCommandRef)}\n`,
  },
  ["matched", "agent", "control", "session_mode", "error"] as const,
);

/**
 * The guard, and the one command it must not eat.
 *
 * Every other slash command asks for work to START, and starting a second run on an
 * issue that already has one is the race this guard exists to prevent. `/stop` is the
 * opposite: its entire meaning is "act on the run that is happening right now", so a
 * guard that deleted it would make it unusable at exactly the moment it is for.
 *
 * The exemption is one command wide on purpose. Nothing else earns it.
 */
const guardStep = new TypedOutputsStep(
  {
    name: "Guard: reject comment while atomaton/in-progress",
    id: "guard",
    if: `(${IS_HUMAN_COMMENT}) && ${parseCommandStep.rawOutputs.control} != 'stop'`,
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
      COMMENT_ID: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.id),
      COMMENTER: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.user.login),
    },
    run: `${scriptCommandWithArgs(guardCommentRef, { number: "\${NUMBER}", "comment-id": "\${COMMENT_ID}", commenter: "\${COMMENTER}" })}\n`,
  },
  ["blocked"] as const,
);

/**
 * The second guard: a command on an issue or pull request that is closed.
 *
 * Narrower than the in-progress guard in three ways, each of which would otherwise
 * make it fire where it has no business. It runs only once a command was actually
 * parsed -- an ordinary comment on a closed issue is just a comment, and a refusal
 * posted on one would be the machinery talking to itself. It skips `/stop`, because an
 * agent can close the issue it is working on and that is the one moment a stop is
 * needed. And it skips a comment the in-progress guard already caught, so a person
 * does not get two notices about one comment.
 */
const closedGuardStep = new TypedOutputsStep(
  {
    name: "Guard: refuse a command on a closed issue or pull request",
    id: "closed-guard",
    if:
      `(${IS_HUMAN_COMMENT}) && ${parseCommandStep.rawOutputs.control} != 'stop' && ` +
      `(${parseCommandStep.rawOutputs.agent} != '' || ${parseCommandStep.rawOutputs.control} != '') && ` +
      `${guardStep.rawOutputs.blocked} != 'true'`,
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
      COMMENTER: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.user.login),
      FROM_COMMAND: parseCommandStep.outputs.agent,
      FROM_CONTROL: parseCommandStep.outputs.control,
    },
    run: `COMMAND="\${FROM_COMMAND:-\${FROM_CONTROL}}"
${scriptCommandWithArgs(guardCommandOnClosedRef, {
  number: "\${NUMBER}",
  commenter: "\${COMMENTER}",
  command: "/\${COMMAND}",
})}
`,
  },
  ["blocked"] as const,
);

const targetStep = new TypedOutputsStep(
  {
    name: "Resolve target context",
    id: "target",
    shell: "bash",
    env: {
      NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
      IS_PR: `\${{ toJSON(${githubEventRaw<IssueCommentCreatedEvent>((e) => e.issue.pull_request)} != null) }}`,
      NOTIFY: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.user.login),
    },
    run: `echo "number=\${NUMBER}" >> "$GITHUB_OUTPUT"
if [ "$IS_PR" = "true" ]; then
  echo "type=pr" >> "$GITHUB_OUTPUT"
else
  echo "type=issue" >> "$GITHUB_OUTPUT"
fi
echo "notify=\${NOTIFY}" >> "$GITHUB_OUTPUT"
`,
  },
  ["number", "type", "notify"] as const,
);

/**
 * `/stop`: take the comment out of the thread and leave the request the run polls for.
 *
 * See `request_stop.ts`. Nothing here waits for the run to actually stop -- that is a
 * different job on a different machine, and the notice saying it stopped is posted by
 * that job, which is the only one that knows.
 */
const stopStep = new TypedOutputsStep({
  name: "Request a stop",
  if: `${parseCommandStep.rawOutputs.control} == 'stop'`,
  shell: "bash",
  env: {
    GH_TOKEN: "${{ github.token }}",
    NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
    COMMENT_ID: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.id),
    COMMENTER: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.user.login),
  },
  run: `${scriptCommandWithArgs(requestStopRef, {
    number: "\${NUMBER}",
    "comment-id": "\${COMMENT_ID}",
    commenter: "\${COMMENTER}",
  })}\n`,
});

/**
 * `/resume`: fill in the agent name from what last ran here, and dispatch it.
 *
 * A step and not part of the parser, because the answer is in the thread rather than
 * in the comment -- see `resolve_resume_agent.ts`.
 */
const resumeStep = new TypedOutputsStep(
  {
    name: "Resolve the agent to resume",
    id: "resume",
    if: `${parseCommandStep.rawOutputs.control} == 'resume'`,
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
    },
    run: `${scriptCommandWithArgs(resolveResumeAgentRef, { number: "\${NUMBER}" })}\n`,
  },
  ["agent"] as const,
);

/**
 * `/resume`: bring back the rest of what a stop held.
 *
 * The node the comment was typed on goes through the ordinary dispatch below, like
 * every other command. This starts its descendants, because a stop reaches the work
 * under an issue and a resume that did not would leave a chain half-running — and
 * would hand somebody the checklist the work tree exists to remove.
 *
 * Best-effort: it starts runs and reports, and never fails the job. The run the person
 * asked for is already on its way by the time this matters.
 */
const resumeSubtreeStep = new TypedOutputsStep({
  name: "Resume the work this issue was stopped with",
  if: `${parseCommandStep.rawOutputs.control} == 'resume' && ${guardStep.rawOutputs.blocked} != 'true' && ${closedGuardStep.rawOutputs.blocked} != 'true'`,
  shell: "bash",
  env: {
    GH_TOKEN: "${{ github.token }}",
    GITHUB_REPOSITORY: "${{ github.repository }}",
    NUMBER: githubEvent<IssueCommentCreatedEvent>((e) => e.issue.number),
    NOTIFY: githubEvent<IssueCommentCreatedEvent>((e) => e.comment.user.login),
  },
  run: `${scriptCommandWithArgs(resumeSubtreeRef, { number: "\${NUMBER}", notify: "\${NOTIFY}" })}
`,
});

/**
 * The one agent name this job dispatches, from whichever command produced it.
 *
 * Also where the guard finally takes effect. It used to work by suppressing the
 * parse, which is no longer possible now that the guard reads the parse -- so what it
 * suppresses is the dispatch, which is the thing it was protecting all along.
 */
const dispatchStep = new TypedOutputsStep(
  {
    name: "Decide what to dispatch",
    id: "dispatch",
    shell: "bash",
    env: {
      FROM_COMMAND: parseCommandStep.outputs.agent,
      FROM_RESUME: resumeStep.outputs.agent,
      BLOCKED: guardStep.outputs.blocked,
      CLOSED: closedGuardStep.outputs.blocked,
    },
    run: `if [ "$BLOCKED" = "true" ] || [ "$CLOSED" = "true" ]; then
  AGENT=""
else
  AGENT="\${FROM_COMMAND:-\${FROM_RESUME}}"
fi
echo "agent=\${AGENT}" >> "$GITHUB_OUTPUT"
echo "dispatching: \${AGENT:-nothing}"
`,
  },
  ["agent"] as const,
);

const commandErrorStep = new TypedOutputsStep({
  name: "Report invalid slash command",
  if: `${parseCommandStep.rawOutputs.error} != ''`,
  shell: "bash",
  env: {
    GH_TOKEN: "${{ github.token }}",
    NUMBER: targetStep.outputs.number,
    ERROR: parseCommandStep.outputs.error,
  },
  run: `gh issue comment "\${NUMBER}" --body "Atomaton command error: \${ERROR}"
`,
});

/**
 * A command on a pull request goes through validation, not straight to the agent.
 *
 * The run a person is asking for is a judgement about a commit, and starting it
 * immediately means it reads a CI result that does not exist yet -- so it either
 * waits with nothing able to wake it, or reviews a commit whose checks have not
 * run. Validation is the thing that runs CI and waits, and it already dispatches
 * whoever the result calls for.
 *
 * So this is the same path an agent's handoff takes, and the same one a push takes.
 * One place knows how to wait, and every agent start on a pull request goes through
 * it.
 *
 * `asked-by-person` is what makes the failure route differ: an agent that broke its
 * own pull request fixes it, and a person who asked for a run is owed the answer
 * themselves. See `ValidationInput.askedByPerson`.
 *
 * The branch is read here rather than passed in, because the comment carries only
 * the number and the validation needs the head branch to run CI against.
 */
const prValidationStep = new TypedOutputsStep({
  name: "Hand the pull request to validation, which waits for CI",
  if:
    `${dispatchStep.rawOutputs.agent} != '' && ${targetStep.rawOutputs.type} == 'pr' && ` +
    `${guardStep.rawOutputs.blocked} != 'true' && ${closedGuardStep.rawOutputs.blocked} != 'true'`,
  shell: "bash",
  env: {
    GH_TOKEN: "${{ github.token }}",
    REPO: "${{ github.repository }}",
    NUMBER: targetStep.outputs.number,
  },
  run: `BRANCH=$(gh pr view "$NUMBER" --repo "$REPO" --json headRefName --jq .headRefName)
if [ -z "$BRANCH" ]; then
  echo "::error::could not read the head branch of PR #$NUMBER; nothing was dispatched"
  exit 1
fi
${scriptCommandWithArgs(dispatchPrValidationRef, {
  repo: "\${REPO}",
  number: "\${NUMBER}",
  branch: "\${BRANCH}",
  "asked-by-person": "true",
})}
`,
});

/**
 * The comment that says a run is waiting on CI.
 *
 * Posted immediately, because the wait is minutes long and a person who typed a
 * command and saw nothing happen has no way to tell a queued run from a broken
 * workflow. It is the same reason the runner posts a start marker: the label says
 * something is happening, and this says what.
 *
 * Tagged out of the model's context. It is addressed to the person who typed the
 * command, and the agent that eventually runs is told the same thing by its own
 * dispatch.
 */
const prWaitingStep = new TypedOutputsStep({
  name: "Say the run is waiting for CI",
  if:
    `${dispatchStep.rawOutputs.agent} != '' && ${targetStep.rawOutputs.type} == 'pr' && ` +
    `${guardStep.rawOutputs.blocked} != 'true' && ${closedGuardStep.rawOutputs.blocked} != 'true'`,
  shell: "bash",
  env: {
    GH_TOKEN: "${{ github.token }}",
    NUMBER: targetStep.outputs.number,
    AGENT: dispatchStep.outputs.agent,
  },
  run: `gh issue comment "$NUMBER" --body "${LLM_CONTEXT_TAG.write("exclude")}
Atomaton: \`\${AGENT}\` will start once CI finishes on this pull request."
`,
});

export const atomaManualComment = new Workflow("atomaton-manual-comment", {
  name: "Atomaton Manual Comment",
  on: {
    issue_comment: { types: ["created"] },
  },
  permissions: ATOMATON_WORKFLOW_PERMISSIONS,
}).addJobs(
  startJob(
    "parse",
    {
      "runs-on": "ubuntu-latest",
      // Broader than PARSE_ALLOWED on purpose: this job now also needs to
      // run for ANY human comment (regardless of association) so guardStep
      // can reject it while atomaton/in-progress is active -- actual
      // parsing/dispatch stays restricted to PARSE_ALLOWED via
      // parseCommandStep's own `if:` above.
      if: `(${IS_HUMAN_COMMENT}) || (${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.user.type)} == 'Bot' && contains(${githubEventRaw<IssueCommentCreatedEvent>((e) => e.comment.body)}, 'atomaton:dispatch'))`,
      outputs: {
        agent: dispatchStep.outputs.agent,
        session_mode: parseCommandStep.outputs.session_mode,
        number: targetStep.outputs.number,
        type: targetStep.outputs.type,
        notify: targetStep.outputs.notify,
      },
    },
    [
      new ActionsCheckoutV4({}),
      new SetupBunAction({ name: "Setup Bun" }),
      // Parse first: the guard below has to know whether this is the one command it
      // must let through.
      parseCommandStep,
      guardStep,
      closedGuardStep,
      targetStep,
      stopStep,
      resumeStep,
      resumeSubtreeStep,
      dispatchStep,
      commandErrorStep,
      prWaitingStep,
      prValidationStep,
    ],
  )
    // A pull request's command does NOT start the runner here. It goes through
    // validation, which runs CI and waits, and dispatches whoever the result calls
    // for -- see `prValidationStep`. Starting the runner directly would have the
    // agent read a CI result that does not exist yet.
    //
    // The condition reads `parseJob.rawOutputs.type`, NOT `targetStep.rawOutputs.type`.
    // A job-level `if:` has no `steps` context -- GitHub refuses the whole workflow
    // file with "Unrecognized named-value: 'steps'", and the run fails in zero
    // seconds with no jobs and no log. The step's value is what the job publishes as
    // its own output, so the two are the same fact; only one of them is reachable
    // from here.
    .then((parseJob) =>
      dispatchToAtomaRunner(parseJob, "inherit", parseJob.outputs.session_mode, `${parseJob.rawOutputs.type} != 'pr'`),
    )
    .jobs(),
);

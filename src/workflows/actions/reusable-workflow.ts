/**
 * reusable-workflow.ts — Type-safe calling convention for `workflow_call`
 * reusable workflows defined by another `*.wac.ts` file in this project
 * (i.e. `atomaton-runner.wac.ts`, called from `atomaton-entry.wac.ts`,
 * `atoma-auto-trigger.wac.ts`, `atomaton-manual-comment.wac.ts`, and
 * `atoma-pr-review.wac.ts`).
 *
 * The upstream `ReusableWorkflowCallJob` (from `@github-actions-workflow-ts`)
 * takes a bare `uses: string` path and an untyped `with: {[k: string]: ...}`
 * object -- nothing connects a call site to the actual `workflow_call.inputs`
 * declared by the target workflow. Renaming/removing/typo'ing an input, or
 * renaming the target workflow's output filename, is a silent runtime break
 * (a bad `with:` key is just dropped by GitHub Actions), not a compile error.
 *
 * `defineCallableWorkflow` closes that gap: given the target `Workflow`
 * instance and an input type `TInputs` (written once, mirroring the
 * workflow's own `workflow_call.inputs`), it returns a `.call()` factory
 * that:
 *   - derives `uses:` from the target workflow's own `.filename`, so the
 *     path can never drift from the actual generated file name.
 *   - type-checks `with:` against `TInputs` at every call site (typo'd,
 *     missing-required, or removed inputs become compile errors).
 */
import { ReusableWorkflowCallJob, type NormalJob, type Workflow } from "@github-actions-workflow-ts/lib";
import type { GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";
import type { JobCondition } from "./base.ts";

type JobRef = NormalJob | ReusableWorkflowCallJob;

export interface CallableWorkflowOptions<TInputs extends object> {
  /** Jobs this call depends on (becomes the job's `needs:`). */
  needs: JobRef[];
  /**
   * The condition gating this call.
   *
   * A `JobCondition`, not a string. A reusable-workflow call IS a job, so its `if:`
   * is evaluated in the job context — which has no `steps.` — and a string here was
   * the same hole `dispatchToAtomaRunner` had. See `actions/base.ts`.
   */
  if?: JobCondition;
  /** Inputs passed to the reusable workflow, type-checked against `TInputs`. */
  with: TInputs;
  /** Secrets forwarded to the reusable workflow. Omit to pass none. */
  secrets?: "inherit" | Record<string, string>;
}

export interface CallableWorkflow<TInputs extends object> {
  /** Build a `ReusableWorkflowCallJob` invoking this workflow, `with:` checked against `TInputs`. */
  call(jobName: string, options: CallableWorkflowOptions<TInputs>): ReusableWorkflowCallJob;
}

export function defineCallableWorkflow<TInputs extends object>(workflow: Workflow): CallableWorkflow<TInputs> {
  const filename = workflow.filename;
  if (!filename) {
    throw new Error("defineCallableWorkflow: target workflow has no filename to derive `uses:` from");
  }
  const uses = `./.github/workflows/${filename}.yml`;

  return {
    call(jobName, options) {
      return new ReusableWorkflowCallJob(jobName, {
        ...(options.if !== undefined ? { if: options.if.toString() } : {}),
        uses,
        with: options.with as unknown as GWT.ReusableWorkflowCallJob["with"],
        ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
      }).needs(options.needs);
    },
  };
}

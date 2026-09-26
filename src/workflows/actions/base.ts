/**
 * base.ts — the typed building blocks every `.wac.ts` file composes workflows
 * from.
 *
 * One theme runs through all of them: in GitHub Actions, everything refers to
 * everything else by a string that nothing checks. `steps.foo.outputs.bar`,
 * `needs.foo.outputs.bar`, `needs: [foo]` — each is a name written twice, in two
 * files, with no error if the two stop agreeing. GitHub resolves an unknown
 * reference to the empty string, so the failure is not a broken workflow but a
 * green one that skipped the work.
 *
 * Each export closes one of those gaps by making the definition the only place
 * the name is written, and every use a TypeScript property:
 *
 *   - `TypedOutputsStep` — a step's own `$GITHUB_OUTPUT` values and `outcome`,
 *     as `.outputs` / `.rawOutputs` / `.outcome` / `.rawOutcome`.
 *   - `DefinedJob` — a job's `outputs:` map doubling as the reference surface,
 *     so `needs.<job>.outputs.<name>` cannot name an output the job lacks.
 *   - `startJob` / `JobChain` — the `needs:` graph derived from the order jobs
 *     are chained in, rather than restated as a list of job-name strings.
 *   - `CustomAction` — a typed `with:` for third-party actions outside the
 *     `@github-actions-workflow-ts/actions` registry. See its own comment for
 *     why it skips that package's semver-tag validation.
 */
import { NormalJob, ReusableWorkflowCallJob, Step } from "@github-actions-workflow-ts/lib";
import type { GeneratedWorkflowTypes as GWT } from "@github-actions-workflow-ts/lib";

export type StepBaseProps = Pick<GWT.Step, "id" | "name" | "if" | "env" | "timeout-minutes">;

/**
 * Base for any step (plain `run:` script or `uses:` action) that wants
 * typo-checked, refactor-safe references to its own `$GITHUB_OUTPUT` values
 * from other steps -- each key in `outputNames` becomes a property on
 * `.outputs` resolving to `${{ steps.<id>.outputs.<name> }}` (for use as an
 * ordinary value, e.g. in `with:`/`env:`/`run:`) and on `.rawOutputs`
 * resolving to the bare `steps.<id>.outputs.<name>` (for composing `if:`
 * conditions -- GitHub Actions explicitly warns that partially wrapping an
 * `if:` expression in `${{ }}` and concatenating literal text around it
 * produces unpredictable results, so `if:` conditions must stay either fully
 * bare or fully `${{ }}`-wrapped, never mixed).
 */
export class TypedOutputsStep<TOutputs extends string = never> extends Step {
  readonly outputs: Record<TOutputs, string>;
  readonly rawOutputs: Record<TOutputs, string>;
  /**
   * This step's `outcome`, in the same two forms as its outputs.
   *
   * `outcome` is not a `$GITHUB_OUTPUT` value -- GitHub sets it -- but it is
   * referenced by step id exactly like one, so it belongs to the same problem
   * this class exists to solve. Seven `if:` conditions in `atomaton-runner.wac.ts`
   * spelled `steps.atoma.outcome` as a literal, which is the one thing renaming
   * a step id does not update.
   *
   * That failure is silent and total: GitHub resolves an unknown step reference
   * to the empty string, `'' == 'success'` is false, and the five steps guarded
   * that way -- the result comment, the run metadata, the saved session, the
   * dirty-worktree notice, the loop control -- simply do not run. The job stays
   * green, having done none of them.
   *
   * Empty when the step has no id, matching `outputs` above: an unidentified
   * step cannot be referenced at all, and an empty string in a condition is
   * visibly wrong where a plausible-looking `steps.undefined.outcome` is not.
   */
  readonly outcome: string;
  readonly rawOutcome: string;

  constructor(stepProps: GWT.Step, outputNames: readonly TOutputs[] = []) {
    super(stepProps);
    this.outputs = {} as Record<TOutputs, string>;
    this.rawOutputs = {} as Record<TOutputs, string>;
    for (const name of outputNames) {
      const ref = this.id ? `steps.${this.id}.outputs.${name}` : "";
      this.outputs[name] = ref ? `\${{ ${ref} }}` : "";
      this.rawOutputs[name] = ref;
    }
    this.rawOutcome = this.id ? `steps.${this.id}.outcome` : "";
    this.outcome = this.rawOutcome ? `\${{ ${this.rawOutcome} }}` : "";
  }
}

/**
 * A reference to a job's own published output, bare — `needs.<job>.outputs.<name>`.
 *
 * A distinct type from the string it holds, because the string is not the point:
 * what matters is that a JOB can resolve this reference. `DefinedJob` is the only
 * thing that makes one, so a reference to a step — which a job cannot see — has no
 * way to become one.
 *
 * `toString()` is what keeps every existing `${job.rawOutputs.foo}` working: a
 * template literal calls it, so the type is invisible wherever the text is all
 * that is wanted, and present wherever a condition is being built.
 */
export class JobOutputRef {
  constructor(private readonly ref: string) {}

  toString(): string {
    return this.ref;
  }
}

/**
 * A condition on a job's `if:`.
 *
 * GitHub evaluates a job-level `if:` in a context with `needs` and `github` but
 * NOT `steps` — a step belongs to a job, so a job cannot read one. A reference to
 * `steps.` there is not a wrong answer, it is an unparseable file: GitHub refuses
 * the whole workflow with "Unrecognized named-value: 'steps'", and the run fails
 * in zero seconds with no jobs and no log.
 *
 * This class is what makes that unrepresentable. It is built from a
 * `JobOutputRef` and there is no other way to make one, so a step reference — the
 * same shape of text and a different thing — cannot reach a job-level `if:`
 * through this type. The constructor is private for the same reason: the only
 * doors are the comparisons below.
 */
export class JobCondition {
  private constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }

  /** `needs.<job>.outputs.<name> == '<value>'` */
  static is(output: JobOutputRef, value: string): JobCondition {
    return new JobCondition(`${output} == '${value}'`);
  }

  /** `needs.<job>.outputs.<name> != '<value>'` */
  static isNot(output: JobOutputRef, value: string): JobCondition {
    return new JobCondition(`${output} != '${value}'`);
  }

  /** Both, joined with `&&`. */
  and(other: JobCondition): JobCondition {
    return new JobCondition(`(${this.text}) && (${other.text})`);
  }
}

/**
 * A `NormalJob` whose `outputs:` map doubles as the single source of truth
 * for typo-checked, refactor-safe `needs.<job>.outputs.<name>` references --
 * the job-level counterpart to `TypedOutputsStep`'s
 * `steps.<id>.outputs.<name>`.
 *
 * Previously this required TWO hand-kept-in-sync declarations: the job's own
 * `outputs: {...}` object (defining what GitHub Actions actually exposes) AND
 * a separate `readonly outputNames = [...] as const` array (defining what TS
 * exposes as `.outputs.foo`) -- nothing enforced the two matched, so a
 * renamed/removed job output could silently desync from its typed accessor.
 * `DefinedJob` derives `.outputs`/`.rawOutputs` directly from
 * `Object.keys(jobProps.outputs)`, so there is exactly one place that lists
 * a job's outputs.
 *
 * Also accepts `steps` and `needs` directly in the constructor (in place of
 * trailing `.addSteps([...])`/`.needs([...])` calls) purely for readability
 * -- a job's full shape (props + dependencies + steps) is then visible in
 * one expression instead of split across a constructor call and chained
 * methods. `needs` is applied before `steps` (matching the order every
 * hand-written call site used before this class existed) so generated YAML
 * key order -- and therefore diffs -- stay stable.
 *
 * Same `.outputs` (`${{ }}`-wrapped, for `with:`/`env:`/`run:`) vs
 * `.rawOutputs` (bare, for `if:`) split as `TypedOutputsStep`, for the same
 * reason (GitHub Actions `if:` conditions must stay fully bare or fully
 * `${{ }}`-wrapped, never mixed).
 *
 * `.rawOutputs` is a `JobOutputRef` rather than a string, and that is the one
 * asymmetry with `TypedOutputsStep`. A step reference is only ever used in a
 * step-level `if:`, where `steps.` is correct and there is nothing to compose;
 * a job reference is what a `JobCondition` is built from, and the type is what
 * keeps a step reference out of one.
 */
/**
 * The props a `DefinedJob` accepts.
 *
 * Named rather than written out at each of the three places that take them
 * (`DefinedJob`, `JobChain.start`, `startJob`), because the one thing that differs
 * from the library's own `NormalJob` is `if:` — and a second spelling of that
 * difference is how the three would stop agreeing.
 */
export type DefinedJobProps<TOutputsMap extends Record<string, string>> = Omit<GWT.NormalJob, "outputs" | "if"> & {
  outputs?: TOutputsMap;
  /**
   * The job's condition, as a `JobCondition` or as text.
   *
   * A `JobCondition` is the way to write one that reads a job's own output, and it
   * is the only way to write one that CANNOT read a step's — see that class. Plain
   * text stays accepted for the conditions that read `github` or `inputs`, which no
   * type here can build.
   */
  if?: string | JobCondition;
};

export class DefinedJob<TOutputsMap extends Record<string, string> = Record<never, string>> extends NormalJob {
  readonly outputs: Record<keyof TOutputsMap & string, string>;
  readonly rawOutputs: Record<keyof TOutputsMap & string, JobOutputRef>;

  constructor(
    name: string,
    jobProps: DefinedJobProps<TOutputsMap>,
    steps: Step[] = [],
    needs: (NormalJob | ReusableWorkflowCallJob)[] = [],
  ) {
    // `if:` is normalised here rather than at every call site, so a `JobCondition`
    // can be passed straight in and read as what it is. The library types the field
    // as `string | number | boolean`, which a class is not — and widening the
    // parameter is the one place that difference has to be reconciled.
    const { if: condition, ...rest } = jobProps;
    super(name, { ...rest, ...(condition === undefined ? {} : { if: condition.toString() }) } as GWT.NormalJob);
    if (needs.length > 0) this.needs(needs);
    if (steps.length > 0) this.addSteps(steps);

    this.outputs = {} as Record<keyof TOutputsMap & string, string>;
    this.rawOutputs = {} as Record<keyof TOutputsMap & string, JobOutputRef>;
    for (const key of Object.keys(jobProps.outputs ?? {}) as (keyof TOutputsMap & string)[]) {
      const ref = `needs.${name}.outputs.${key}`;
      this.outputs[key] = `\${{ ${ref} }}`;
      this.rawOutputs[key] = new JobOutputRef(ref);
    }
  }
}

/**
 * Express a "producer job -> consumer job -> ..." dependency as an actual
 * fluent chain of calls -- each link sits at the same indentation level,
 * reading top to bottom, instead of a named `const producerJob = ...` the
 * caller has to declare purely so it can be passed to the next job AND
 * separately remembered in `addJobs([...])`:
 *
 *   .addJobs(
 *     startJob("parse", { ...outputs: {...} }, [step1, step2])
 *       .then((parseJob) => dispatchToAtomaRunner(parseJob, "inherit"))
 *       .jobs(),
 *   )
 *
 * An EARLIER version of this expressed the same idea as a single function
 * call, `chainJob(name, props, steps, next)`, with `next` as a positional
 * argument -- that reads fine when `next` is a one-liner (as above), but
 * once `next` itself builds a whole multi-line job (see
 * atomaton-sub-issue-closed.wac.ts), it degenerates into a callback buried
 * inside another call's argument list -- nested callback-pyramid style, not
 * an actual chain. `.then(...)` fixes that: it's a real method call that
 * can be stacked one after another, each one visually independent.
 *
 * Each job still exists as a real value (GitHub Actions' own job graph
 * requires a stable reference to appear in both the `jobs:` map and any
 * `needs:`/output read -- no wrapper can remove that indirection, it's
 * inherent to the model, not a styling choice) -- it just lives only inside
 * `.then()`'s callback parameter scope instead of a caller-visible
 * top-level `const`.
 *
 * Only fits a genuinely LINEAR producer -> consumer chain, where each link
 * depends on exactly the one immediately before it. A real multi-hop DAG
 * (e.g. atomaton-pr-merged.wac.ts, where two downstream jobs each need both
 * their immediate predecessor AND its predecessor) still needs actual named
 * handles -- that's an honest reflection of a real graph, not something a
 * linear chain can flatten away.
 */
export class JobChain<TCurrent extends NormalJob | ReusableWorkflowCallJob> {
  private constructor(
    private readonly allJobs: readonly (NormalJob | ReusableWorkflowCallJob)[],
    /** The most recently added job/reusable-workflow-call in this chain. */
    readonly current: TCurrent,
  ) {}

  /** Start a chain with a freshly-defined job. */
  static start<TOutputsMap extends Record<string, string> = Record<never, string>>(
    name: string,
    jobProps: DefinedJobProps<TOutputsMap>,
    steps: Step[] = [],
  ): JobChain<DefinedJob<TOutputsMap>> {
    const job = new DefinedJob(name, jobProps, steps);
    return new JobChain([job], job);
  }

  /** Build the next link from the current one, without ever naming it. */
  then<TNext extends NormalJob | ReusableWorkflowCallJob>(next: (current: TCurrent) => TNext): JobChain<TNext> {
    const nextJob = next(this.current);
    return new JobChain([...this.allJobs, nextJob], nextJob);
  }

  /** Every job/reusable-workflow-call added so far, in order -- pass this straight to `.addJobs(...)`. */
  jobs(): (NormalJob | ReusableWorkflowCallJob)[] {
    return [...this.allJobs];
  }
}

/** Start a `JobChain` -- see `JobChain`'s own doc comment for the full rationale. */
export function startJob<TOutputsMap extends Record<string, string> = Record<never, string>>(
  name: string,
  jobProps: DefinedJobProps<TOutputsMap>,
  steps: Step[] = [],
): JobChain<DefinedJob<TOutputsMap>> {
  return JobChain.start(name, jobProps, steps);
}


/**
 * Typed wrapper for GitHub composite actions that aren't in the public
 * `@github-actions-workflow-ts/actions` registry (e.g. third-party actions
 * like `oven-sh/setup-bun`, see `third-party.ts`).
 *
 * Unlike that package's `BaseAction`, this does NOT attempt marketplace
 * semver-tag validation (that machinery assumes a public `owner/repo@vX`
 * action pinned to a released version; some third-party actions are pinned
 * to a branch like `@main`, not a semver tag). What it DOES give us,
 * matching the same idea as `BaseAction`:
 *   - A typed `with` object -- a typo'd or missing required input is a
 *     compile error.
 *   - A typed `outputs` object (via `TypedOutputsStep`) -- referencing a
 *     step's output elsewhere is typo-checked and refactor-safe.
 */
export abstract class CustomAction<
  TWith extends object,
  TOutputs extends string = never,
> extends TypedOutputsStep<TOutputs> {
  constructor(uses: string, props: StepBaseProps & { with: TWith }, outputNames: readonly TOutputs[] = []) {
    super({ ...props, uses, with: props.with as unknown as GWT.Env }, outputNames);
  }
}


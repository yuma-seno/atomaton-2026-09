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

/**
 * The props a step accepts.
 *
 * `if:` accepts a `StepCondition` as well as the library's plain string, unlike
 * `DefinedJobProps.if`, which is a `JobCondition` and nothing else.
 *
 * The asymmetry is the point. A job-level `if:` reading `steps.` makes GitHub
 * refuse the whole file, so there the type has to be the only way in. A
 * step-level `if:` may read `steps.` freely, so a string is not a hazard — and
 * most step conditions here are `always()` or `inputs.type == 'issue'`, which
 * read no reference at all and gain nothing from being built. Where a step
 * condition does read a reference, `Condition` is available and typo-checked.
 */
export type StepBaseProps = Omit<GWT.Step, "if"> & { if?: StepCondition | string };

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
  readonly rawOutputs: Record<TOutputs, StepOutputRef>;
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
  readonly rawOutcome: StepOutputRef;

  constructor(stepProps: StepBaseProps, outputNames: readonly TOutputs[] = []) {
    // `if:` is normalised here for the same reason `DefinedJob` does it: the
    // library types the field as `string | number | boolean`, and a `StepCondition`
    // is a class. A plain string passes through unchanged.
    const { if: condition, ...rest } = stepProps;
    super({ ...rest, ...(condition === undefined ? {} : { if: condition.toString() }) } as GWT.Step);
    this.outputs = {} as Record<TOutputs, string>;
    this.rawOutputs = {} as Record<TOutputs, StepOutputRef>;
    for (const name of outputNames) {
      const ref = this.id ? `steps.${this.id}.outputs.${name}` : "";
      this.outputs[name] = ref ? `\${{ ${ref} }}` : "";
      this.rawOutputs[name] = new StepOutputRef(ref);
    }
    this.rawOutcome = new StepOutputRef(this.id ? `steps.${this.id}.outcome` : "");
    this.outcome = this.id ? `\${{ steps.${this.id}.outcome }}` : "";
  }
}

/**
 * A reference GitHub resolves at run time.
 *
 * The text is what reaches the YAML; the type is what says WHERE the text may be
 * read. `steps.<id>.outputs.<name>` is resolved inside a job, so a job-level `if:`
 * cannot read it — and GitHub does not report that as a wrong answer, it refuses
 * the whole file with "Unrecognized named-value: 'steps'". See `Condition`.
 */
export abstract class Ref {
  constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

/** `steps.<id>.outputs.<name>` — a step's own output. Readable in a step's `if:` only. */
export class StepOutputRef extends Ref {}

/** `needs.<job>.outputs.<name>` — a job's published output. Readable in both. */
export class JobOutputRef extends Ref {}

/**
 * `needs.<job>.result` — a job's outcome, which GitHub sets rather than the job.
 *
 * Not a `$GITHUB_OUTPUT` value, but referenced by job name exactly like one, so it
 * belongs to the same problem `JobOutputRef` solves: `needs.deploy.result` spelled
 * as a literal is a name renaming the job does not update, and GitHub resolves an
 * unknown job reference to the empty string — `'' == 'success'` is false, and the
 * job guarded that way silently does not run.
 */
export class JobResultRef extends Ref {}

/** `github.event.<path>` — the event payload. Readable in both. */
export class EventRef extends Ref {}

/** What a JOB-level `if:` may read. */
export type JobRef = JobOutputRef | JobResultRef | EventRef;

/** What a STEP-level `if:` may read. */
export type StepRef = StepOutputRef | JobRef;

/**
 * A comparison value, as GitHub Actions writes it.
 *
 * A string is quoted and a boolean is not, and the difference is not cosmetic:
 * `github.event.pull_request.merged` is a boolean, so `== true` is the test and
 * `== 'true'` is always false — a condition that silently never fires. Taking
 * `string | boolean` here is what lets the caller write the value it means.
 */
function literal(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : `'${value}'`;
}

/**
 * A condition, and the context it is valid in.
 *
 * `R` is the set of references the condition reads, and it is what makes the
 * context check work. A job-level `if:` takes `JobCondition`; a step-level one
 * takes `StepCondition`. `JobRef` is a subset of `StepRef`, so a job condition is
 * valid in both places and a step condition is valid in one — which is exactly the
 * rule GitHub enforces, and the reason a `steps.` reference in a job-level `if:` is
 * now a compile error rather than a workflow file GitHub refuses to parse.
 *
 * `Condition<never>` reads nothing, so it is valid everywhere: that is what
 * `always()` and `of()` produce.
 */
export class Condition<R extends Ref = never> {
  /**
   * A phantom field, never assigned and erased at compile time.
   *
   * It exists so `R` is part of the class's structure: without it,
   * `Condition<EventRef>` and `Condition<StepRef>` would be structurally
   * identical and freely assignable to each other, which is the one thing this
   * type is here to prevent.
   */
  declare private readonly reads: R;

  protected constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }

  /** `<ref> == <value>` — a string is quoted, a boolean is not. */
  static is<R extends Ref>(ref: R, value: string | boolean): Condition<R> {
    return new Condition(`${ref} == ${literal(value)}`);
  }

  /** `<ref> != <value>` — a string is quoted, a boolean is not. */
  static isNot<R extends Ref>(ref: R, value: string | boolean): Condition<R> {
    return new Condition(`${ref} != ${literal(value)}`);
  }

  /** `always()` — true whatever the dependencies did. */
  static always(): Condition<never> {
    return new Condition("always()");
  }

  /**
   * A condition from text this module cannot build.
   *
   * The escape hatch, and it is deliberately narrow: the text must read no
   * `steps.`, because a job-level `if:` cannot and GitHub refuses the file. The
   * check is at run time because the text is a string — which is the whole reason
   * the typed factories above exist.
   */
  static of(text: string): Condition<never> {
    if (/\bsteps\./.test(text)) {
      throw new Error(
        `Condition.of: ${JSON.stringify(text)} reads steps., which a job-level if: cannot. ` +
          "Build it from a JobOutputRef or an EventRef instead.",
      );
    }
    return new Condition(text);
  }

  /** Both, joined with `&&`. */
  and<R2 extends Ref>(other: Condition<R2>): Condition<R | R2> {
    return new Condition(`(${this.text}) && (${other.text})`);
  }

  /** Either, joined with `||`. */
  or<R2 extends Ref>(other: Condition<R2>): Condition<R | R2> {
    return new Condition(`(${this.text}) || (${other.text})`);
  }
}

/**
 * A condition on a job's `if:`. Cannot read `steps.`.
 *
 * A class rather than a type alias, so it is both the type a `DefinedJob` takes
 * and the value a call site builds with — `JobCondition.isNot(...)`. An alias
 * would have made every call site import `Condition` as well, which is the same
 * name written twice for no gain.
 *
 * It does NOT extend `Condition`, and that is deliberate. A subclass's static side
 * has to be assignable to its base's, and narrowing `is` from `Condition<R>` to
 * `JobCondition` is not — the base promises to return whatever `R` the caller
 * named, and this one always returns a job condition. Composition says the same
 * thing without the lie: this holds a `Condition<JobRef>` and narrows what may be
 * built, which is the whole of what it adds.
 */
export class JobCondition {
  private constructor(private readonly condition: Condition<JobRef>) {}

  toString(): string {
    return this.condition.toString();
  }

  /** `<ref> == <value>` — a string is quoted, a boolean is not. */
  static is<R extends JobRef>(ref: R, value: string | boolean): JobCondition {
    return new JobCondition(Condition.is(ref, value));
  }

  /** `<ref> != <value>` — a string is quoted, a boolean is not. */
  static isNot<R extends JobRef>(ref: R, value: string | boolean): JobCondition {
    return new JobCondition(Condition.isNot(ref, value));
  }

  /** `always()` — true whatever the dependencies did. */
  static always(): JobCondition {
    return new JobCondition(Condition.always());
  }

  /** A condition from text this module cannot build. Refuses `steps.`. */
  static of(text: string): JobCondition {
    return new JobCondition(Condition.of(text));
  }

  /**
   * A job condition from one built for a wider context.
   *
   * `Condition<EventRef>` is valid in both contexts — the event payload is readable
   * from a job's `if:` and from a step's — so narrowing it to a job condition is
   * sound. This is the one direction that is: a `Condition<StepRef>` may read
   * `steps.`, and there is deliberately no way to make a job condition from one.
   */
  static from(condition: Condition<EventRef>): JobCondition {
    return new JobCondition(condition);
  }

  /** Both, joined with `&&`. */
  and(other: JobCondition): JobCondition {
    return new JobCondition(this.condition.and(other.condition));
  }

  /** Either, joined with `||`. */
  or(other: JobCondition): JobCondition {
    return new JobCondition(this.condition.or(other.condition));
  }
}

/** A condition on a step's `if:`. May read `steps.` and `needs.`. */
export type StepCondition = Condition<StepRef>;

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
export type DefinedJobProps<TOutputsMap extends Record<string, string>> = Omit<
  GWT.NormalJob,
  "outputs" | "if" | "needs"
> & {
  outputs?: TOutputsMap;
  /**
   * The job's condition.
   *
   * A `JobCondition`, and nothing else. It was `string | JobCondition`, and the
   * string half was the hole: a job-level `if:` cannot read `steps.`, and text
   * pasted in from a step is exactly how that happened. `JobCondition.of` is the
   * escape hatch for the conditions this module cannot build, and it refuses the
   * one thing that must not appear.
   */
  if?: JobCondition;
  /**
   * The jobs this one depends on.
   *
   * `DefinedJob`s, not names. A `needs:` entry that names nothing is not an error
   * to GitHub — it is a dependency that does not exist, so the job runs
   * immediately and reads empty outputs from a job that never ran. Taking the job
   * itself is what makes a typo a compile error, and it is the same argument
   * `JobOutputRef` makes about reading an output.
   */
  needs?: DefinedJob[];
};

export class DefinedJob<TOutputsMap extends Record<string, string> = Record<never, string>> extends NormalJob {
  readonly outputs: Record<keyof TOutputsMap & string, string>;
  readonly rawOutputs: Record<keyof TOutputsMap & string, JobOutputRef>;
  /**
   * This job's `result`, as a reference a `JobCondition` can be built from.
   *
   * `needs.<job>.result` is `success` / `failure` / `cancelled` / `skipped`, and
   * GitHub sets it — but it is referenced by job name exactly like an output, so
   * it is the same hazard: a literal `needs.deploy.result` is a name renaming the
   * job does not update, and an unknown job reference resolves to the empty
   * string, which is not `success`.
   */
  readonly rawResult: JobResultRef;

  constructor(
    name: string,
    jobProps: DefinedJobProps<TOutputsMap>,
    steps: Step[] = [],
  ) {
    // `if:` is normalised here rather than at every call site, so a `JobCondition`
    // can be passed straight in and read as what it is. The library types the field
    // as `string | number | boolean`, which a class is not — and widening the
    // parameter is the one place that difference has to be reconciled.
    //
    // `needs:` is taken out for the same reason in the other direction: the library
    // wants names, and this class takes the jobs themselves. `this.needs()` is what
    // turns them back into names, from the jobs' own `name`.
    const { if: condition, needs: dependencies, ...rest } = jobProps;
    super(name, { ...rest, ...(condition === undefined ? {} : { if: condition.toString() }) } as GWT.NormalJob);
    if (dependencies && dependencies.length > 0) this.needs(dependencies);
    if (steps.length > 0) this.addSteps(steps);

    this.outputs = {} as Record<keyof TOutputsMap & string, string>;
    this.rawOutputs = {} as Record<keyof TOutputsMap & string, JobOutputRef>;
    for (const key of Object.keys(jobProps.outputs ?? {}) as (keyof TOutputsMap & string)[]) {
      const ref = `needs.${name}.outputs.${key}`;
      this.outputs[key] = `\${{ ${ref} }}`;
      this.rawOutputs[key] = new JobOutputRef(ref);
    }
    this.rawResult = new JobResultRef(`needs.${name}.result`);
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


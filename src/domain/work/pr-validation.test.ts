import { describe, expect, test } from "bun:test";
import { CI_RETRY_LIMIT, contextsPassed, decideValidationOutcome } from "./pr-validation.ts";

/** The two agents, named once: every case here routes between the same pair. */
const agents = { reviewerAgent: "reviewer", engineerAgent: "engineer" };

const decide = (conclusion: string, priorRetries = 0) =>
  decideValidationOutcome({ conclusion, ...agents, priorRetries });

describe("decideValidationOutcome", () => {
  test("a successful run writes passing checks and hands to the reviewer", () => {
    const outcome = decide("success");
    expect(outcome.verdict).toBe("passed");
    expect(contextsPassed(outcome.verdict)).toBe(true);
    expect(outcome.next?.agent).toBe("reviewer");
  });

  // GitHub's own list of conclusions that satisfy a required check, so a job the
  // repository chose to skip must not read as a defect to fix.
  test("skipped and neutral pass like success", () => {
    for (const conclusion of ["skipped", "neutral"]) {
      const outcome = decide(conclusion);
      expect(outcome.verdict, conclusion).toBe("passed");
      expect(outcome.next?.agent, conclusion).toBe("reviewer");
      expect(contextsPassed(outcome.verdict), conclusion).toBe(true);
    }
  });

  test("a failing run writes failing checks and returns to the engineer", () => {
    const outcome = decide("failure");
    expect(outcome.verdict).toBe("failed");
    expect(contextsPassed(outcome.verdict)).toBe(false);
    expect(outcome.next?.agent).toBe("engineer");
    expect(outcome.summary).toContain("failure");
  });

  test("cancelled and timed_out return to the engineer too", () => {
    for (const conclusion of ["cancelled", "timed_out"]) {
      expect(decide(conclusion).next?.agent, conclusion).toBe("engineer");
    }
  });

  // No conclusion means the run never reported -- it timed out here, or could not
  // be found. There is no defect for an engineer to fix, and dispatching one
  // spends a model run to discover that. Block the merge and stop.
  test("no conclusion writes a failing check but dispatches nobody", () => {
    const outcome = decide("");
    expect(outcome.verdict).toBe("no-conclusion");
    expect(contextsPassed(outcome.verdict)).toBe(false);
    expect(outcome.next).toBeUndefined();
    expect(outcome.summary).toContain("human");
  });

  /**
   * The reason `verdict` exists, and why the check runs are no longer built here.
   *
   * `validate_pull_request.ts` used to ask `checks.every((c) => c.conclusion ===
   * "success")` of a list this function returned, one entry per required context.
   * An empty array answers `true` — so a failing run on a base branch requiring no
   * checks posted no failure comment, dispatched the engineer with no brief, and
   * never advanced the tally that bounds the retry loop.
   *
   * The list is gone: it restated the verdict once per context, and a field
   * derivable from another field is a second answer to one question. Which
   * contexts exist is the caller's to know; whether they pass is this.
   */
  test("how many contexts there are does not reach this decision at all", () => {
    expect(contextsPassed(decide("failure").verdict)).toBe(false);
    expect(decide("failure").verdict).toBe("failed");
  });

  test("conclusions are matched case- and space-insensitively", () => {
    expect(decide("  SUCCESS ").next?.agent).toBe("reviewer");
  });

  // The loop this bounds is the one `manage_dispatch_loop.ts` cannot see: the
  // engineer is dispatched by a workflow rather than by a directive it wrote, so
  // that counter never advances and failing CI would cycle indefinitely.
  describe("retry limit", () => {
    test("keeps returning to the engineer below the limit", () => {
      for (let prior = 0; prior < CI_RETRY_LIMIT; prior++) {
        expect(decide("failure", prior).next?.agent, `prior=${prior}`).toBe("engineer");
      }
    });

    test("stops dispatching at the limit and says why", () => {
      const outcome = decide("failure", CI_RETRY_LIMIT);
      expect(outcome.verdict).toBe("retries-exhausted");
      expect(outcome.next).toBeUndefined();
      expect(outcome.summary).toContain("human");
    });

    // The check still has to be written, or the pull request would look
    // unvalidated rather than failing.
    test("still writes a failing check when it gives up", () => {
      const outcome = decide("failure", CI_RETRY_LIMIT);
      expect(contextsPassed(outcome.verdict)).toBe(false);
    });

    test("a passing run is unaffected by earlier retries", () => {
      const outcome = decide("success", CI_RETRY_LIMIT + 5);
      expect(outcome.verdict).toBe("passed");
      expect(outcome.next?.agent).toBe("reviewer");
    });
  });
});

/**
 * A pull request whose own `.github/atomaton/` cannot start a run.
 *
 * Judged before the CI conclusion, and treated as a red CI run rather than as a
 * broken job: failing checks so the merge is blocked, and the engineer dispatched
 * to fix what it wrote. The alternative — a failed workflow step — writes no check
 * at all, which leaves the required context pending forever and dispatches nobody.
 */
describe("a deliverable that cannot start a run", () => {
  const problems = ["engineer.md: mcp_servers 'shell': not found in tools file"];

  const decideWith = (deliverableProblems: string[], conclusion = "", priorRetries = 0) =>
    decideValidationOutcome({
      conclusion,
      ...agents,
      priorRetries,
      deliverableProblems,
    });

  test("blocks the merge and returns to the engineer", () => {
    const outcome = decideWith(problems);
    expect(outcome.verdict).toBe("deliverable-invalid");
    expect(contextsPassed(outcome.verdict)).toBe(false);
    expect(outcome.next?.agent).toBe("engineer");
  });

  // The count belongs in the summary; the problems themselves travel in the
  // comment. `summary` is also a step output, which is one line by construction.
  test("the summary names the count and stays one line", () => {
    const outcome = decideWith([...problems, "chain.labels.launched must be a non-empty label name."]);
    expect(outcome.summary).toContain("(2 problems)");
    expect(outcome.summary).not.toContain("\n");
  });

  test("one problem is not pluralised", () => {
    expect(decideWith(problems).summary).toContain("(1 problem)");
  });

  /**
   * The ordering that matters. CI was never dispatched, so `conclusion` is empty —
   * which on its own means `no-conclusion`, a verdict that deliberately dispatches
   * NOBODY because there is no defect to hand anyone. Here there is one, and its
   * author is the agent that just wrote it.
   */
  test("an empty conclusion is not read as a run that never reported", () => {
    expect(decideWith(problems, "").verdict).toBe("deliverable-invalid");
    expect(decideWith([], "").verdict).toBe("no-conclusion");
  });

  // A green CI run cannot rescue it: what CI checked is the repository's own code,
  // and what is broken is the machinery the NEXT run loads.
  test("a passing CI conclusion does not override it", () => {
    expect(decideWith(problems, "success").verdict).toBe("deliverable-invalid");
    expect(decideWith(problems, "success").next?.agent).toBe("engineer");
  });

  // The same bound as failing CI, and for the same reason: the engineer is
  // dispatched by a workflow, so nothing else stops the loop.
  test("the retry limit applies", () => {
    for (const prior of [0, CI_RETRY_LIMIT - 1]) {
      expect(decideWith(problems, "", prior).next?.agent, `prior=${prior}`).toBe("engineer");
    }
    const outcome = decideWith(problems, "", CI_RETRY_LIMIT);
    expect(outcome.verdict).toBe("retries-exhausted");
    expect(outcome.next).toBeUndefined();
    expect(outcome.summary).toContain("human");
    expect(contextsPassed(outcome.verdict)).toBe(false);
  });

  test("an empty list is the normal case and changes nothing", () => {
    expect(decideWith([], "success").verdict).toBe("passed");
    expect(decideWith([], "failure").verdict).toBe("failed");
  });
});

/**
 * A role nobody is configured for.
 *
 * `nextAgent: string` could hold `""` and did at every hand-back, so a role left
 * unnamed produced the same value as a deliberate stop — and the only thing
 * separating them was a `!= ''` in the workflow. `next` being absent says it once,
 * in the type, and the check it used to need is gone with it.
 */
describe("a role with nobody in it", () => {
  test("hands off to nobody rather than to an agent called \"\"", () => {
    const outcome = decideValidationOutcome({
      conclusion: "success",
      reviewerAgent: "",
      engineerAgent: "engineer",
    });
    expect(outcome.verdict).toBe("passed");
    expect(outcome.next).toBeUndefined();
  });

  test("whitespace is not a name either", () => {
    const outcome = decideValidationOutcome({
      conclusion: "failure",
      reviewerAgent: "reviewer",
      engineerAgent: "   ",
    });
    expect(outcome.verdict).toBe("failed");
    expect(outcome.next).toBeUndefined();
  });
});

/**
 * Who a failed check goes back to, which depends on who asked for the run.
 *
 * An agent that opened a pull request and broke CI is the one that should fix it:
 * it has the context and it is already in the loop. A person who asked for a run
 * and got a red check is owed the answer themselves -- handing their request to an
 * agent would be the machinery deciding on their behalf, and the agent would be
 * working from a request it did not make.
 *
 * So a person's failed run dispatches nobody, and the caller mentions them. The
 * check is still written, so the merge is still blocked.
 */
describe("a run a person asked for", () => {
  const decideForPerson = (conclusion: string, priorRetries = 0) =>
    decideValidationOutcome({ conclusion, ...agents, askedByPerson: true, priorRetries });

  test("a failed check goes back to the person, not to an agent", () => {
    const outcome = decideForPerson("failure");
    expect(outcome.verdict).toBe("failed");
    expect(outcome.next).toBeUndefined();
    expect(outcome.summary).toContain("person");
  });

  // The check is what blocks the merge, and it is written from the verdict -- so a
  // person's failed run must still be a failing verdict rather than a new one.
  test("the check is still written as failing", () => {
    expect(contextsPassed(decideForPerson("failure").verdict)).toBe(false);
  });

  // A passing run is unaffected: the agent the pull request names is the one that
  // should look at it, whoever asked for the run.
  test("a passing run still hands to the agent the pull request names", () => {
    expect(decideForPerson("success").next?.agent).toBe("reviewer");
  });

  // The retry bound is about the engineer/CI loop, which a person's run is not in.
  // Reaching it must not change the answer, or a person's third red check would
  // suddenly dispatch an agent.
  test("the retry limit does not turn it into an agent dispatch", () => {
    expect(decideForPerson("failure", CI_RETRY_LIMIT).next).toBeUndefined();
  });

  // An agent's run is unchanged, which is the half that must not regress.
  test("an agent's failed run still returns to the engineer", () => {
    expect(decide("failure").next?.agent).toBe("engineer");
  });
});

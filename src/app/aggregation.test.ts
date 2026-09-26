import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeConfigDir, runWithFakeGh, type FakeGhRule, importable } from "../entrypoints/machinery/testing/harness.ts";

const LIB_DIR = import.meta.dir;

/**
 * Run the gate against a faked `gh` and report what it decided and what it did.
 *
 * The subprocess is not optional: mutating PATH and calling a `gh`-shelling
 * function in the long-lived bun:test process has given wrong results before.
 * See this file's sibling, `lib.test.ts`, for the same harness and the same rule.
 */
function runGate(rules: FakeGhRule[]): { kind: string; ghCalls: string[][]; stderr: string } {
  const configDir = makeConfigDir({});
  const dir = mkdtempSync(join(tmpdir(), "atomaton-gate-"));
  const file = join(dir, "shim.ts");
  writeFileSync(
    file,
    `import { dispatchOrchestratorIfReady } from "${importable(join(LIB_DIR, "aggregation.ts"))}";
const result = await dispatchOrchestratorIfReady({ repo: "owner/repo", parent: 5, closedNum: 10 });
console.log(result.kind);
`,
  );
  try {
    const r = runWithFakeGh(file, [], { cwd: configDir, rules });
    return { kind: r.stdout.trim().split("\n").pop() ?? "", ghCalls: r.ghCalls, stderr: r.stderr };
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Did the gate start the atomaton? That is a `workflow run` dispatch. */
const dispatched = (calls: string[][]) => calls.some((c) => c.includes("workflow") && c.includes("run"));

/** Did it claim the completion by writing the idempotency marker? */
const wroteMarker = (calls: string[][]) =>
  calls.some((c) => c.includes("comment") && c.some((a) => a.includes("atomaton:aggregated")));

/**
 * The sub-issue links, which is where siblings come from now -- `atomaton:parent=N
 * in:body` and the tag behind it are gone. See `adapters/github/parent-issue.ts`.
 */
const subIssues = (...numbers: number[]): FakeGhRule => ({
  match: ["graphql"],
  stdout: JSON.stringify({
    data: {
      repository: {
        issueOrPullRequest: {
          __typename: "Issue",
          subIssues: {
            nodes: numbers.map((number) => ({
              number,
              title: `#`,
              state: "OPEN",
              labels: { nodes: [{ name: "atomaton/sub-issue" }, { name: "atomaton/launched" }] },
            })),
          },
        },
      },
    },
  }),
});

const NO_SIBLINGS: FakeGhRule = subIssues();
const NO_MARKER: FakeGhRule = { match: ["issue", "view"], stdout: "some unrelated comment" };

// The fake `gh` exits 1 for any call no rule matches, which is the right
// default -- a test should not accidentally succeed through a call it never
// described. These two are the calls the happy path makes after the checks:
// claiming the completion, and starting the atomaton.
const MARKER_WRITES: FakeGhRule = { match: ["issue", "comment"], code: 0 };
const DISPATCH_WORKS: FakeGhRule = { match: ["workflow", "run"], code: 0 };
// Two calls read the parent through this endpoint, and only one of them is
// optional. `resolveNotify` looks it up to find someone to mention and tolerates
// a failure; `dispatchRunner` reads its state and refuses to dispatch onto
// anything it cannot confirm is open. So this answers with a state -- `{}` used
// to be enough, and would now make every test below report a closed parent.
const PARENT_IS_OPEN: FakeGhRule = { match: ["api", "issues"], stdout: JSON.stringify({ state: "open" }) };

describe("aggregation.ts dispatch gate", () => {
  test("dispatches once when the siblings are done and nobody claimed it", () => {
    const { kind, ghCalls } = runGate([NO_SIBLINGS, NO_MARKER, MARKER_WRITES, DISPATCH_WORKS, PARENT_IS_OPEN]);
    expect(kind).toBe("dispatched");
    expect(wroteMarker(ghCalls)).toBe(true);
    expect(dispatched(ghCalls)).toBe(true);
  });

  /**
   * The case this gate walked into on #803: the last sibling lands, and the parent
   * somebody closed in the meantime is not something to start an atomaton on.
   *
   * The marker is already written by then, so nothing else will pick this up -- which
   * is why the answer has to be its own kind rather than `dispatch-failed`. Nothing
   * malfunctioned, and work is still left undone.
   */
  test("a closed parent is not dispatched onto, and says so as its own answer", () => {
    const { kind, ghCalls } = runGate([
      NO_SIBLINGS,
      NO_MARKER,
      MARKER_WRITES,
      DISPATCH_WORKS,
      { match: ["api", "issues"], stdout: JSON.stringify({ state: "closed" }) },
    ]);
    expect(kind).toBe("parent-closed");
    expect(dispatched(ghCalls)).toBe(false);
    // The person who asked for the run is told on the issue, by `dispatchRunner`.
    const notice = ghCalls.find((c) => c.includes("comment") && c.some((a) => a.includes("was not started")));
    expect(notice?.join(" ")).toContain("Nothing will retry");
  });

  test("siblings still open is `waiting`, and nothing is claimed", () => {
    const { kind, ghCalls } = runGate([
      subIssues(11),
    ]);
    expect(kind).toBe("waiting");
    expect(wroteMarker(ghCalls)).toBe(false);
    expect(dispatched(ghCalls)).toBe(false);
  });

  test("another caller's marker makes this one a no-op", () => {
    const { kind, ghCalls } = runGate([
      NO_SIBLINGS,
      { match: ["issue", "view"], stdout: "<!-- atomaton:aggregated=10 -->" },
    ]);
    expect(kind).toBe("already-aggregated");
    expect(dispatched(ghCalls)).toBe(false);
  });

  // The defect this issue was filed for. The marker IS the idempotency claim, so
  // failing to write it and dispatching anyway means the other racer -- which by
  // construction is running right now -- finds no marker, decides it is first,
  // and dispatches the atomaton a second time. A missed aggregation is
  // recoverable by that racer; a double dispatch is not.
  test("a failed marker write stops the dispatch rather than racing on", () => {
    const { kind, ghCalls, stderr } = runGate([
      NO_SIBLINGS,
      NO_MARKER,
      { match: ["issue", "comment"], code: 1, stdout: "API rate limit exceeded" },
    ]);
    expect(kind).toBe("undetermined");
    expect(dispatched(ghCalls)).toBe(false);
    expect(stderr).toContain("aggregation marker");
  });

  // The read half of the same argument, which was already guarded. Kept so the
  // two halves cannot drift apart again.
  test("an unreadable comment list stops the dispatch too", () => {
    const { kind, ghCalls } = runGate([
      NO_SIBLINGS,
      { match: ["issue", "view"], code: 1, stdout: "not found" },
    ]);
    expect(kind).toBe("undetermined");
    expect(wroteMarker(ghCalls)).toBe(false);
    expect(dispatched(ghCalls)).toBe(false);
  });

  // `countOpenSiblings` throws rather than returning, and that exception used to
  // escape the gate entirely -- one call site wrapped it in try/catch and the
  // other did not, which was not a policy.
  test("an unreadable sibling list is undetermined, not an escaping exception", () => {
    const { kind, ghCalls } = runGate([{ match: ["graphql"], code: 1, stdout: "gh: not found" }]);
    expect(kind).toBe("undetermined");
    expect(dispatched(ghCalls)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  descendants,
  listNodes,
  nodesToClose,
  nodesToResume,
  nodesToStop,
  resumeCandidates,
  subtree,
  type WorkNode,
} from "./work-tree.ts";

function issue(number: number, parent?: number, extra: Partial<WorkNode> = {}): WorkNode {
  return { number, kind: "issue", state: "open", running: false, parent, ...extra };
}
function pr(number: number, parent: number, extra: Partial<WorkNode> = {}): WorkNode {
  return { number, kind: "pull-request", state: "open", running: false, parent, ...extra };
}

/**
 * The tree this project actually builds: an orchestrator's issue, the sub-issues it
 * filed, and the pull request one of them opened.
 */
const TREE = [
  issue(803),
  issue(807, 803),
  issue(808, 803),
  pr(817, 807),
  issue(999), // somebody else's work, at the same level
];

describe("subtree", () => {
  test("is the node a person named, and everything under it", () => {
    expect(subtree(TREE, 803).map((n) => n.number)).toEqual([803, 807, 808, 817]);
  });

  test("names the node itself first, so a caller can tell it apart", () => {
    expect(subtree(TREE, 803)[0]?.number).toBe(803);
  });

  /** A pull request is a leaf, so its subtree is itself. */
  test("a pull request has nothing under it", () => {
    expect(subtree(TREE, 817).map((n) => n.number)).toEqual([817]);
  });

  test("a node not in the set has no subtree", () => {
    expect(subtree(TREE, 12345)).toEqual([]);
  });

  test("unrelated work at the same level is not swept in", () => {
    expect(subtree(TREE, 803).map((n) => n.number)).not.toContain(999);
  });

  /**
   * The tools cannot write a cycle, but a person editing an issue body can. An
   * unbounded walk over one is a job that never ends.
   */
  test("a cycle written by hand terminates", () => {
    const cyclic = [issue(1, 2), issue(2, 1)];
    expect(subtree(cyclic, 1).map((n) => n.number)).toEqual([1, 2]);
  });
});

describe("nodesToStop", () => {
  /**
   * Not filtered by state, and this is the case that decides it: an agent closes the
   * issue it is working on and keeps going, which is how a run finishes. That closed
   * node is holding a run, and it is the one a person wants stopped.
   */
  test("reaches a closed node that is still running", () => {
    const nodes = [issue(1, undefined, { state: "closed", running: true })];
    expect(nodesToStop(nodes).map((n) => n.number)).toEqual([1]);
  });

  test("leaves alone every node nothing is running on", () => {
    expect(nodesToStop(subtree(TREE, 803))).toEqual([]);
  });

  test("reaches every running node in the subtree, not only the root", () => {
    const running = [
      issue(803, undefined, { running: true }),
      issue(807, 803, { running: true }),
      issue(808, 803),
    ];
    expect(nodesToStop(subtree(running, 803)).map((n) => n.number)).toEqual([803, 807]);
  });
});

describe("nodesToClose", () => {
  test("closes what is open", () => {
    expect(nodesToClose(subtree(TREE, 803)).map((n) => n.number)).toEqual([803, 807, 808, 817]);
  });

  /**
   * GitHub cannot close a merged pull request, and a closed node is already where
   * this would put it. Attempting either would report a failure that is not one.
   */
  test("leaves a merged pull request and an already closed issue alone", () => {
    const nodes = [
      issue(1),
      issue(2, 1, { state: "closed" }),
      pr(3, 1, { state: "merged" }),
    ];
    expect(nodesToClose(subtree(nodes, 1)).map((n) => n.number)).toEqual([1]);
  });
});

describe("resumeCandidates and nodesToResume", () => {
  const nodes = [
    issue(1, undefined),
    issue(2, 1),
    issue(3, 1), // ran and finished
    issue(4, 1, { state: "closed" }),
    issue(5, 1, { running: true }),
  ];
  /** What the caller learns from the thread, one request per candidate. */
  const stoppedLast = new Set([1, 2, 4, 5]);
  const resumable = (): number[] =>
    nodesToResume(resumeCandidates(subtree(nodes, 1)), stoppedLast).map((n) => n.number);

  test("restarts the nodes a stop interrupted", () => {
    expect(resumable()).toEqual([1, 2]);
  });

  /** Without this a resume over a subtree would restart everything that ever ran. */
  test("does not restart a node whose run finished", () => {
    expect(resumable()).not.toContain(3);
  });

  test("does not restart closed work", () => {
    expect(resumable()).not.toContain(4);
  });

  /** A second run on a live node is the race the in-progress guard exists to prevent. */
  test("does not start a second run where one is already going", () => {
    expect(resumable()).not.toContain(5);
  });

  /**
   * The reason the ending is an argument rather than a field. `stoppedLast?: boolean`
   * on `WorkNode` was a contract `readWorkTree` could not meet, so a tree handed
   * straight in came back empty and said nothing about why.
   */
  test("asks for the endings separately, so a caller cannot forget them", () => {
    expect(resumeCandidates(subtree(nodes, 1)).map((n) => n.number)).toEqual([1, 2, 3]);
    expect(nodesToResume(resumeCandidates(subtree(nodes, 1)), new Set())).toEqual([]);
  });
});

describe("descendants", () => {
  test("is the subtree without the node a person named", () => {
    expect(descendants(subtree(TREE, 803), 803).map((n) => n.number)).toEqual([807, 808, 817]);
  });
});

describe("listNodes", () => {
  test("names them the way a person reads them", () => {
    expect(listNodes([issue(12), issue(13)])).toBe("#12, #13");
  });

  test("says nothing when there are none", () => {
    expect(listNodes([])).toBe("");
  });
});

/**
 * work-tree.ts — the shape of the work itself: a tree of issues, with pull requests
 * as its leaves.
 *
 * ## The model
 *
 * **Work in this project is a tree of issues.** An orchestrator files sub-issues under
 * the one it was given; an engineer opens a pull request under the issue it delivers.
 * Every one of those is a node, and every node has at most one parent.
 *
 * A person acts on a node, and means the work under it. So **stop and close both reach
 * the whole subtree**, and what separates them is not their reach but their finality:
 *
 * | | reach | ending | undone by |
 * | --- | --- | --- | --- |
 * | stop | the node and everything under it | held | `/resume` over the same subtree |
 * | close | the node and everything under it | over | nothing; reopening is not undo |
 *
 * ## Why not "you cannot stop a parent"
 *
 * That was the other candidate, and it confuses position with state. An orchestrator
 * runs ON the parent — at the start, and again when its children are all in — so a
 * parent has runs of its own. A `/stop` aimed at a parent misses today not because it
 * is a parent but because nothing happens to be executing on it at that moment, and
 * that is true of any node.
 *
 * What the old behaviour did instead was hand the person a checklist: it listed the
 * children that were running and asked them to go and stop each one. That is the
 * machinery turning the narrowness of its own vocabulary into somebody else's manual
 * work.
 *
 * ## No new state
 *
 * A stopped run still ends and still drops the in-progress label — `control-commands.ts`
 * argues that out, and nothing here reopens it. "Stopped" is not stored: a node is
 * resumable when it is open, nothing is running on it, and its last run ended on a
 * stop, and all three are readable from the tree and the thread. So `/resume` needs no
 * record of what a `/stop` covered; it asks the same question again.
 *
 * ## One edge, two records
 *
 * "What is this under" is one edge, and the model here has a single `parent`. On the
 * wire it is two records, and they are two because GitHub can only keep one of them:
 * an issue's parent is GitHub's own sub-issue link, and a pull request's is the
 * `atomaton:parent-issue` tag, because GitHub drops its own PR-to-issue link as soon
 * as anything but that pull request's merge closes the issue — which this design does
 * twice over. `adapters/github/tags.ts` carries the measurement.
 *
 * It used to be two TAGS, `atomaton:parent` and `atomaton:parent-issue`, read in turn
 * with `??` even where the kind was already known. The first is gone.
 *
 * Pure: a caller reads the nodes from GitHub, and everything below is arithmetic on
 * them.
 */

/** A pull request is a leaf; an issue may have children. */
export type NodeKind = "issue" | "pull-request";

/**
 * Open, closed, or merged.
 *
 * `merged` exists because a merged pull request has left the tree: GitHub cannot
 * reopen one, so there is nothing there to stop and nothing to close. Folding it into
 * `closed` would make the close pass try, and fail, on every delivered change in the
 * subtree.
 */
export type NodeState = "open" | "closed" | "merged";

export interface WorkNode {
  number: number;
  kind: NodeKind;
  state: NodeState;
  /** What this node is under. Absent at a root, whatever the wire spelling was. */
  parent?: number;
  /** A turn is in flight here: something is working on this node and nothing else may. */
  running: boolean;
}

/** How deep a chain this will walk before deciding it has found a cycle. */
export const MAX_DEPTH = 10;

/**
 * `root` and everything under it, nearest first.
 *
 * Breadth-first so the order reads the way the work was built: the node the person
 * named, then its children, then theirs. A node whose parent is not in `nodes` is
 * simply not reached — this answers over what it was given rather than asking for
 * more, which is what keeps it pure.
 *
 * Depth-capped and visit-marked. A cycle cannot be written through the tools, but it
 * can be written by hand into an issue body, and an unbounded walk over one is a job
 * that never ends.
 */
export function subtree(nodes: readonly WorkNode[], root: number): WorkNode[] {
  const byParent = new Map<number, WorkNode[]>();
  const byNumber = new Map<number, WorkNode>();
  for (const node of nodes) {
    byNumber.set(node.number, node);
    if (node.parent === undefined) continue;
    const siblings = byParent.get(node.parent) ?? [];
    siblings.push(node);
    byParent.set(node.parent, siblings);
  }

  const start = byNumber.get(root);
  if (!start) return [];

  const found: WorkNode[] = [start];
  const seen = new Set<number>([root]);
  let frontier = [root];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const parent of frontier) {
      for (const child of byParent.get(parent) ?? []) {
        if (seen.has(child.number)) continue;
        seen.add(child.number);
        found.push(child);
        next.push(child.number);
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * The nodes a stop has to reach.
 *
 * Deliberately not filtered by state. An agent can close the issue it is working on
 * and keep going — that is how a run finishes — so a closed node can still be holding
 * a run, and it is exactly the one a person wants stopped.
 */
export function nodesToStop(nodes: readonly WorkNode[]): WorkNode[] {
  return nodes.filter((node) => node.running);
}

/**
 * The nodes a close has to reach.
 *
 * Open ones only. A merged pull request cannot be closed and a closed node is already
 * where this would put it, so both are left alone rather than attempted and reported
 * as failures.
 */
export function nodesToClose(nodes: readonly WorkNode[]): WorkNode[] {
  return nodes.filter((node) => node.state === "open");
}

/**
 * The nodes a `/resume` could reach on the tree alone.
 *
 * Two of the three conditions, and both are answerable from a node as it is read.
 * Still open, because closed work is over. Nothing running, because a second run on a
 * live node is the race the in-progress guard exists to prevent.
 *
 * Separate from `nodesToResume` because the third condition is not a property of the
 * tree: how a node's last turn ended is one request per node, and asking it of a whole
 * subtree would be a request each for an answer most of them cannot use. So the rule
 * is in two halves, in the order a caller can afford to ask them.
 */
export function resumeCandidates(nodes: readonly WorkNode[]): WorkNode[] {
  return nodes.filter((node) => node.state === "open" && !node.running);
}

/**
 * Of those candidates, the ones a resume has something to continue.
 *
 * The third condition: the last turn on this node ended on a stop. Without it a resume
 * over a subtree would restart every node that had ever run.
 *
 * It arrives as an argument rather than as a field on `WorkNode` because it is not a
 * fact about the tree — it is how the last turn ended, which lives in the thread. It
 * WAS a field, `stoppedLast?: boolean`, and `readWorkTree` had no way to fill it: the
 * one caller patched each node before calling this, and anyone else passing a tree
 * straight in got an empty list with nothing to say why.
 */
export function nodesToResume(candidates: readonly WorkNode[], stoppedLast: ReadonlySet<number>): WorkNode[] {
  return candidates.filter((node) => stoppedLast.has(node.number));
}

/** Every node but the one the person named. */
export function descendants(nodes: readonly WorkNode[], root: number): WorkNode[] {
  return nodes.filter((node) => node.number !== root);
}

/** `#12, #13`, or "" when there are none — the one spelling for naming nodes to a person. */
export function listNodes(nodes: readonly WorkNode[]): string {
  return nodes.map((node) => `#${node.number}`).join(", ");
}

/**
 * What a node reads when a stop aimed higher up reaches it.
 *
 * Says where it came from, because nobody typed anything here and an unexplained stop
 * on an issue somebody is watching is indistinguishable from a malfunction. The
 * recovery is named at the root as well: resuming one node of a subtree that was
 * stopped as a unit is how a chain comes back half-running.
 */
export function stopReachedNotice(root: number): string {
  return [
    `Atomaton: a stop on #${root} reached this work, so the run here has been asked to stop.`,
    "",
    "It stops after its current step, so it may take a minute, and it will report here when it has.",
    "",
    `To pick the work back up, comment \`/resume\` on #${root} — that restarts everything this stop held, rather than this piece alone.`,
  ].join("\n");
}

/**
 * What a node reads when a close aimed higher up reaches it.
 *
 * A close is not undone, so this offers no way back — saying "reopen it" would invite
 * somebody to restart one node of a lineage that was ended as a whole.
 */
export function closeReachedNotice(root: number): string {
  return [
    `Atomaton: #${root} was closed, and this work was under it, so it is closed too.`,
    "",
    "Any run here has been asked to stop.",
  ].join("\n");
}

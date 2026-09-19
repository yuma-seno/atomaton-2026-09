/**
 * work-tree.ts — read the work tree out of GitHub, so `domain/work-tree.ts` can do
 * arithmetic on it.
 *
 * ## Why a walk rather than one query
 *
 * There is no single query for "everything under #803", so the tree is found by
 * descending one level at a time. The trees this builds are shallow — an issue, its
 * sub-issues, their pull requests.
 *
 * ## Two sources for one edge, and why neither alone will do
 *
 * The tag, because `addSubIssue` is best-effort: a sub-issue an agent created can
 * carry `atomaton:parent=<n>` and no native link at all. `parent-issue.ts` reached the
 * same conclusion walking upward, and reads both for the same reason.
 *
 * GitHub's own links, because the tag only exists where an agent has been. An issue a
 * person opened, decomposed with the sub-issue control and closed is a tree this would
 * otherwise see as a single node — and closing it would leave its children open. That
 * argument is `issue-links.ts`'s, written before this file existed, and this file was
 * built tag-only anyway by copying the narrower reader next to it.
 *
 * So: the union. The tag search carries labels and answers in one call per level; the
 * native links are asked once per level and cost a second read only for what they alone
 * found, which is by construction the node no agent made.
 *
 * ## The search is a prefilter, never the answer
 *
 * GitHub tokenizes, so a query for `atomaton:parent=5` also returns the sub-issues of
 * #50. Every result is checked against the tag reader before it is believed — the same
 * trap `running-children.ts` and `aggregate_sub_issues.ts` document, and the reason
 * both of them re-read the body they just searched on.
 *
 * ## What a failed read means here
 *
 * A subtree that could not be read in full is reported as such rather than returned
 * short. The callers act on what they are given — a stop posts to every node, a close
 * closes every node — and a partial tree silently treated as whole is a close that
 * leaves work running with nobody told.
 */
import { gh, ghRead } from "./gh.ts";
import { getLabel } from "./config.ts";
import { issueLinks } from "./issue-links.ts";
import { ENDED_TAG, LLM_CONTEXT_TAG, PARENT_ISSUE_TAG, PARENT_TAG, STOP_TAG } from "./tags.ts";
import {
  closeReachedNotice,
  descendants,
  MAX_DEPTH,
  nodesToClose,
  nodesToStop,
  stopReachedNotice,
  subtree,
  type NodeState,
  type WorkNode,
} from "../domain/work-tree.ts";

interface Listed {
  number: number;
  body?: string;
  state?: string;
  labels?: ({ name?: string } | string)[];
}

function labelNames(labels: Listed["labels"]): string[] {
  return (labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
}

function parseListed(stdout: string): Listed[] {
  try {
    return JSON.parse(stdout || "[]") as Listed[];
  } catch {
    return [];
  }
}

/** One node, read through the endpoint that answers for an issue and a pull request alike. */
function readNode(repo: string, number: number): { node?: WorkNode; problem?: string } {
  const { code, stdout, stderr } = ghRead("api", `repos/${repo}/issues/${number}`);
  if (code !== 0) {
    return { problem: `could not read #${number}: ${(stderr || stdout).trim().split("\n")[0] ?? ""}` };
  }
  let raw: {
    state?: string;
    body?: string;
    labels?: { name?: string }[];
    pull_request?: { merged_at?: string | null };
  };
  try {
    raw = JSON.parse(stdout) as typeof raw;
  } catch {
    return { problem: `the response for #${number} was not JSON` };
  }

  const isPr = raw.pull_request !== undefined;
  const merged = Boolean(raw.pull_request?.merged_at);
  const state: NodeState = merged ? "merged" : raw.state === "open" ? "open" : "closed";
  if (raw.state !== "open" && raw.state !== "closed") {
    return { problem: `#${number} reported an unrecognised state ${JSON.stringify(raw.state ?? null)}` };
  }

  return {
    node: {
      number,
      kind: isPr ? "pull-request" : "issue",
      state,
      parent: PARENT_TAG.read(raw.body ?? "") ?? PARENT_ISSUE_TAG.read(raw.body ?? ""),
      running: labelNames(raw.labels).includes(getLabel("in_progress")),
    },
  };
}

/** The issues filed under `parent`, and the pull requests opened for it. */
function readChildren(repo: string, parent: number): { nodes: WorkNode[]; problems: string[] } {
  const label = getLabel("in_progress");
  const nodes: WorkNode[] = [];
  const problems: string[] = [];

  const issues = ghRead(
    "issue", "list", "--repo", repo, "--state", "all", "--limit", "200",
    "--search", `${PARENT_TAG.search(parent)} in:body`,
    "--json", "number,body,state,labels",
  );
  if (issues.code !== 0) problems.push(`could not list the sub-issues of #${parent}`);
  for (const found of parseListed(issues.stdout)) {
    if (PARENT_TAG.read(found.body ?? "") !== parent) continue;
    nodes.push({
      number: found.number,
      kind: "issue",
      state: found.state === "OPEN" ? "open" : "closed",
      parent,
      running: labelNames(found.labels).includes(label),
    });
  }

  const prs = ghRead(
    "pr", "list", "--repo", repo, "--state", "all", "--limit", "200",
    "--search", `${PARENT_ISSUE_TAG.search(parent)} in:body`,
    "--json", "number,body,state,labels",
  );
  if (prs.code !== 0) problems.push(`could not list the pull requests for #${parent}`);
  for (const found of parseListed(prs.stdout)) {
    if (PARENT_ISSUE_TAG.read(found.body ?? "") !== parent) continue;
    nodes.push({
      number: found.number,
      kind: "pull-request",
      // A merged pull request has left the tree, and `gh` says so directly here.
      state: found.state === "OPEN" ? "open" : found.state === "MERGED" ? "merged" : "closed",
      parent,
      running: labelNames(found.labels).includes(label),
    });
  }

  // What no agent tagged. `issueLinks` reads GitHub's own sub-issue links and the pull
  // requests that say they close this issue, and its docstring is the argument for
  // asking it at all: "the relationships have to survive an issue a person opened,
  // decomposed and closed without an agent ever touching it, and markers only exist
  // where an agent has been."
  //
  // A union rather than a replacement, because the tag survives what the native link
  // does not: `addSubIssue` is best-effort, so a sub-issue can carry the tag and no
  // link. `parent-issue.ts` reaches the same conclusion walking the other way.
  const links = issueLinks(repo, parent);
  if (links.unavailable) {
    problems.push(`could not read GitHub's own links for #${parent}: ${links.unavailable}`);
  }
  const already = new Set(nodes.map((node) => node.number));
  for (const linked of [...links.children, ...links.pullRequests]) {
    if (already.has(linked.number)) continue;
    // Only these need a second read. The search above returns labels; this one does
    // not, and `running` is what decides whether a stop has anywhere to go. Rare by
    // construction — it is the node an agent did not create.
    const { node, problem } = readNode(repo, linked.number);
    if (!node) {
      problems.push(problem ?? `could not read #${linked.number}`);
      continue;
    }
    already.add(linked.number);
    nodes.push({ ...node, parent });
  }

  return { nodes, problems };
}

/**
 * `root` and everything under it.
 *
 * `problems` is not decoration: a caller that closes a subtree has to know whether the
 * subtree it is closing is the whole one.
 */
export function readWorkTree(repo: string, root: number): { nodes: WorkNode[]; problems: string[] } {
  const { node, problem } = readNode(repo, root);
  if (!node) return { nodes: [], problems: [problem ?? `could not read #${root}`] };

  const nodes: WorkNode[] = [node];
  const problems: string[] = [];
  const seen = new Set<number>([root]);
  let frontier = [root];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const parent of frontier) {
      const found = readChildren(repo, parent);
      problems.push(...found.problems);
      for (const child of found.nodes) {
        if (seen.has(child.number)) continue;
        seen.add(child.number);
        nodes.push(child);
        // A merged pull request is a leaf that has left the tree, and nothing is ever
        // filed under one, so it is not descended into.
        if (child.kind === "issue") next.push(child.number);
      }
    }
    frontier = next;
  }

  return { nodes, problems };
}

/**
 * How the last run on `number` ended, from the most recent result comment that says.
 *
 * Read newest first, and `undefined` when nothing says — an issue whose runs all
 * predate `ENDED_TAG`, or one that has never run. `/resume` treats that as "nothing
 * interrupted here", which is the answer that starts no work it was not asked for.
 */
export function lastEnding(repo: string, number: number): string | undefined {
  const { code, stdout } = ghRead(
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", ".[].body",
  );
  if (code !== 0) return undefined;
  const bodies = stdout.split("\n");
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    const ended = ENDED_TAG.read(bodies[i] ?? "");
    if (ended) return ended;
  }
  return undefined;
}

/** Post one comment, and say whether it landed. Used by every subtree-wide action. */
export function commentOn(repo: string, number: number, body: string): boolean {
  return gh("issue", "comment", String(number), "--repo", repo, "--body", body).code === 0;
}

/** What a subtree-wide stop did, in the words its caller reports with. */
export interface SubtreeStop {
  /** The nodes a stop request was posted on, the root included when it was running. */
  stopped: number[];
  /**
   * Whether the comment meant for the person landed on the root.
   *
   * Its own field, because callers used to decide this by looking for the root|s number
   * in the problem strings -- which matched a problem ABOUT the root as readily as a
   * failure to reach it, and turned a warning about its links into a failed step.
   */
  rootNotified: boolean;
  /** Anything that could not be read or written. A partial answer says so. */
  problems: string[];
}

/**
 * Ask every run in `root`'s subtree to stop, and leave `rootBody` where the person
 * will look.
 *
 * The root's comment is posted whether or not a run holds it: it is the answer to what
 * the person did, and a parent whose chain runs on its children has no run of its own
 * to speak for it. The tag rides along regardless, which costs nothing — a stop
 * request older than a run's own start is ignored by the watcher by design.
 *
 * Descendants are told where the stop came from. Nobody typed anything on them, and an
 * unexplained stop on an issue somebody is watching reads as a malfunction.
 */
export function requestStopAcross(
  repo: string,
  root: number,
  rootBody: string,
): SubtreeStop {
  const { nodes, problems } = readWorkTree(repo, root);
  const all = subtree(nodes, root);
  const stopped: number[] = [];

  const rootNotified = commentOn(repo, root, rootBody);
  if (!rootNotified) problems.push(`could not post the stop request on #${root}`);
  else if (all.find((node) => node.number === root)?.running) stopped.push(root);

  for (const node of nodesToStop(descendants(all, root))) {
    const body = [LLM_CONTEXT_TAG.write("exclude"), STOP_TAG.write("requested"), stopReachedNotice(root)].join("\n");
    if (commentOn(repo, node.number, body)) stopped.push(node.number);
    else problems.push(`could not post the stop request on #${node.number}`);
  }

  return { stopped, rootNotified, problems };
}

/** What a subtree-wide close did. */
export interface SubtreeClose extends SubtreeStop {
  /** The nodes that were closed, the root excluded — GitHub closed that one already. */
  closed: number[];
}

/**
 * Close everything under `root`, having asked every run in it to stop.
 *
 * The root itself is not closed here: this runs on the `issues: closed` event, so it
 * is already closed by the time anything below happens. Stopping comes first, so a run
 * that is about to be closed out from under is told before it is.
 */
export function closeSubtreeUnder(repo: string, root: number, rootBody: string): SubtreeClose {
  const { nodes, problems } = readWorkTree(repo, root);
  const all = subtree(nodes, root);
  const stopped: number[] = [];
  const closed: number[] = [];

  const rootNotified = commentOn(repo, root, rootBody);
  if (!rootNotified) problems.push(`could not post the stop request on #${root}`);
  else if (all.find((node) => node.number === root)?.running) stopped.push(root);

  const under = descendants(all, root);
  for (const node of nodesToStop(under)) {
    const body = [LLM_CONTEXT_TAG.write("exclude"), STOP_TAG.write("requested"), closeReachedNotice(root)].join("\n");
    if (commentOn(repo, node.number, body)) stopped.push(node.number);
    else problems.push(`could not post the stop request on #${node.number}`);
  }

  for (const node of nodesToClose(under)) {
    // A pull request is closed through its own command; `gh issue close` refuses one.
    const closeIt = node.kind === "pull-request"
      ? gh("pr", "close", String(node.number), "--repo", repo)
      : gh("issue", "close", String(node.number), "--repo", repo);
    if (closeIt.code === 0) closed.push(node.number);
    else problems.push(`could not close #${node.number}`);
  }

  return { stopped, closed, rootNotified, problems };
}

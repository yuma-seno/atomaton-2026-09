/**
 * work-tree.ts — read the work tree out of GitHub, so `domain/work/work-tree.ts` can do
 * arithmetic on it.
 *
 * ## Why a walk rather than one query
 *
 * There is no single query for "everything under #803", so the tree is found by
 * descending one level at a time. The trees this builds are shallow — an issue, its
 * sub-issues, their pull requests.
 *
 * ## One source per kind of edge, and why they differ
 *
 * A sub-issue comes from GitHub's own link, which is the only record of that edge —
 * `create_issue` fails rather than leave one unmade. It also covers what no agent
 * made: an issue a person opened, decomposed with the sub-issue control and closed is
 * a tree this would otherwise see as a single node, and closing it would leave its
 * children open. That argument is `issue-links.ts`'s.
 *
 * A pull request comes from its `atomaton:parent-issue` tag, because GitHub's own
 * PR-to-issue link does not survive here. Measured: of nine pull requests this
 * repository tagged, two carried a `closingIssuesReferences` entry. GitHub drops the
 * link once anything but that pull request's merge closes the issue, and this design
 * does that twice — a sub-issue's pull request merges into its PARENT's branch, so
 * the auto-close never fires, and the post-merge agent closes the sub-issue itself.
 *
 * ## The pull request search is a prefilter, never the answer
 *
 * GitHub tokenizes, so a query for `atomaton:parent-issue=5` also returns the pull
 * requests of #50. Every result is checked against the tag reader before it is
 * believed — the same trap `aggregate_sub_issues.ts` used to document, and the reason
 * it re-read the body it had just searched on.
 *
 * ## What a failed read means here
 *
 * A subtree that could not be read in full is reported as such rather than returned
 * short. The callers act on what they are given — a stop posts to every node, a close
 * closes every node — and a partial tree silently treated as whole is a close that
 * leaves work running with nobody told.
 */
import { gh, ghRead } from "./gh.ts";
import { getLabel } from "../../adapters/runner/config.ts";
import { issueLinks } from "./issue-links.ts";
import { issueOutcome, pullRequestOutcome, saysOpen } from "./outcome.ts";
import { ENDED_TAG, LLM_CONTEXT_TAG, PARENT_ISSUE_TAG, STOP_TAG } from "./tags.ts";
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
} from "../../domain/work/work-tree.ts";

interface Listed {
  number: number;
  body?: string;
  state?: string;
  labels?: ({ name?: string } | string)[];
}

function labelNames(labels: Listed["labels"]): string[] {
  return (labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
}

/**
 * The listing, or null when it could not be read as one.
 *
 * Null rather than `[]`, because the two answers travel to the same place and mean
 * opposite things. `[]` is "this parent has no children of that kind"; an unreadable
 * listing is "nobody knows", and a stop that walks a tree built from the second
 * reaches whatever it happened to see and reports success.
 *
 * The failed CALL was already reported. This is the narrower case — `gh` exited zero
 * and handed back something that is not JSON — and it was the one that answered
 * "none".
 */
function parseListed(stdout: string): Listed[] | null {
  try {
    return JSON.parse(stdout || "[]") as Listed[];
  } catch {
    return null;
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
    state_reason?: string | null;
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
  if (raw.state !== "open" && raw.state !== "closed") {
    return { problem: `#${number} reported an unrecognised state ${JSON.stringify(raw.state ?? null)}` };
  }
  const state: NodeState =
    raw.state === "open"
      ? "open"
      : isPr
        ? pullRequestOutcome(Boolean(raw.pull_request?.merged_at))
        : issueOutcome(raw.state_reason);

  return {
    node: {
      number,
      kind: isPr ? "pull-request" : "issue",
      state,
      // A pull request's parent is its `atomaton:parent-issue` tag; an issue's is
      // GitHub's own sub-issue link, read by the caller that walks downward. This
      // used to be `PARENT_TAG.read(body) ?? PARENT_ISSUE_TAG.read(body)` — two
      // spellings tried in turn, three lines after `isPr` had already settled which
      // one this is, so an issue carrying a pull request's tag was accepted without
      // a word.
      parent: isPr ? PARENT_ISSUE_TAG.read(raw.body ?? "") : undefined,
      running: labelNames(raw.labels).includes(getLabel("in_progress")),
    },
  };
}

/**
 * The issues filed under `parent`, and the pull requests opened for it.
 *
 * The issues come from GitHub's own sub-issue links, through `issueLinks`, which is
 * the single record of that edge — see `adapters/github/parent-issue.ts`. There used to be a
 * search for `atomaton:parent=N in:body` beside it and a union afterwards, because
 * `addSubIssue` was best-effort and a sub-issue could carry the tag and no link. It
 * is not best-effort any more: `create_issue` fails if the link cannot be made, so
 * the link is what there is.
 *
 * Pull requests still come from their own tag. GitHub's PR-to-issue link is not
 * usable here and the reason is measured rather than assumed: of nine pull requests
 * this repository tagged, two carried a `closingIssuesReferences` entry. GitHub drops
 * the link once something other than that pull request's merge closes the issue, and
 * two things in this design do exactly that — a sub-issue's pull request merges into
 * its PARENT's branch rather than the default one, so the auto-close never fires, and
 * the post-merge agent closes the sub-issue itself. See `adapters/github/tags.ts`.
 */
function readChildren(repo: string, parent: number): { nodes: WorkNode[]; problems: string[] } {
  const label = getLabel("in_progress");
  const nodes: WorkNode[] = [];
  const problems: string[] = [];

  const prs = ghRead(
    "pr", "list", "--repo", repo, "--state", "all", "--limit", "200",
    "--search", `${PARENT_ISSUE_TAG.search(parent)} in:body`,
    "--json", "number,body,state,labels",
  );
  if (prs.code !== 0) problems.push(`could not list the pull requests for #${parent}`);
  const listedPrs = parseListed(prs.stdout);
  if (listedPrs === null) problems.push(`the pull request listing for #${parent} was not readable`);
  for (const found of listedPrs ?? []) {
    if (PARENT_ISSUE_TAG.read(found.body ?? "") !== parent) continue;
    nodes.push({
      number: found.number,
      kind: "pull-request",
      // `gh` says outright whether it merged, so the outcome needs nothing else.
      state: saysOpen(found.state) ? "open" : pullRequestOutcome(found.state === "MERGED"),
      parent,
      running: labelNames(found.labels).includes(label),
    });
  }

  // The sub-issues, and the pull requests GitHub itself knows about. `issueLinks`'s
  // docstring is the argument for asking it: "the relationships have to survive an
  // issue a person opened, decomposed and closed without an agent ever touching it,
  // and markers only exist where an agent has been."
  //
  // Children arrive with their labels, in the same request, so `running` needs no
  // second read for them. A pull request GitHub knows about and the tag search above
  // missed still does — rare by construction, since it is one no agent opened.
  const links = issueLinks(repo, parent);
  if (links.unavailable) {
    problems.push(`could not read GitHub's own links for #${parent}: ${links.unavailable}`);
  }
  const already = new Set(nodes.map((node) => node.number));
  for (const child of links.children) {
    if (already.has(child.number)) continue;
    already.add(child.number);
    nodes.push({
      number: child.number,
      kind: "issue",
      // Already the tree.s vocabulary: `issue-links.ts` reads GitHub.s reason and
      // answers in it, so there is nothing left here to decide.
      state: child.state,
      parent,
      running: child.labels.includes(label),
    });
  }
  for (const linked of links.pullRequests) {
    if (already.has(linked.number)) continue;
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

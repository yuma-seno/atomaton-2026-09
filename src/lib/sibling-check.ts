/**
 * sibling-check.ts — Count open sub-issues (siblings) still linked to a
 * parent issue. The one canonical implementation, used directly (no more
 * subprocess spawn) by lib/aggregation.ts's shared dispatch gate.
 *
 * ## Where the children come from
 *
 * GitHub's own sub-issue links, through `issueLinks`, which is also where the tree,
 * the tools and the aggregation gate get them. It used to be a search for
 * `atomaton:parent=N in:body` — a second answer to "what is under this issue", read
 * out of a marker `create_issue` wrote once and nothing ever rewrote. A person
 * re-parenting a sub-issue in the web UI moved the native link and not the marker,
 * so this gate went on counting under the old parent while `parentIssueOf` followed
 * the new one. Both confident, neither aware of the other. See `lib/parent-issue.ts`.
 *
 * The labels arrive in the same request, so the change costs no extra call: one
 * GraphQL query where there was one search.
 */
import { getLabel } from "./config.ts";
import { issueLinks } from "./issue-links.ts";

export interface CountOpenSiblingsOptions {
  repo: string;
  parent: number;
  label?: string;
  launchedLabel?: string;
  /**
   * Drop this specific issue number from the count regardless of its live
   * open/closed state on GitHub -- used right after a PR merges its linked
   * sub-issue, when the caller already KNOWS that sub-issue's work is done
   * even though native "Closes #N" auto-close (or an async
   * re-invocation-driven close) may not have landed yet, so relying on the
   * live search index alone would under-report completion.
   */
  exclude?: number;
}

/**
 * Only counts siblings that have actually been dispatched (labeled
 * "launched"). Sub-issues created but not yet launched (e.g. a later phase
 * in a dependency-ordered plan) must NOT block re-invocation of the
 * orchestrator, otherwise the count can never reach zero.
 *
 * Throws when the children could not be read, and that is the point: this number
 * decides whether the orchestrator is re-invoked, and a list nobody could read
 * counted as zero would dispatch it while its children are still working.
 */
export function countOpenSiblings(opts: CountOpenSiblingsOptions): number {
  const label = opts.label || getLabel("sub_issue");
  const launchedLabel = opts.launchedLabel || getLabel("launched");

  const links = issueLinks(opts.repo, opts.parent);
  if (links.unavailable) {
    throw new Error(`countOpenSiblings: could not read the sub-issues of #${opts.parent}: ${links.unavailable}`);
  }

  return links.children.filter(
    (child) =>
      child.state === "open" &&
      child.labels.includes(label) &&
      child.labels.includes(launchedLabel) &&
      child.number !== opts.exclude,
  ).length;
}

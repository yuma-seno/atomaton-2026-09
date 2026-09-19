/**
 * running-children.ts — the sub-issues of a parent that an agent is working on now.
 *
 * Asked by both ways a parent's run can be stopped: a `/stop` comment on the parent,
 * and closing the parent while it works. Neither reaches the children — their sessions
 * are separate — so both have to say so, and a person who was not told would read a
 * quiet issue as a stopped chain.
 *
 * Every failure here is silent. The stop itself is the thing that matters and has
 * already been requested by the time this is asked; a list of children improves the
 * notice rather than being a precondition for it.
 */
import { gh } from "./gh.ts";
import { getLabel } from "./config.ts";
import { PARENT_TAG } from "./tags.ts";

export function runningChildren(repo: string, parent: number): number[] {
  const label = getLabel("in_progress");
  const { code, stdout } = gh(
    "issue", "list", "--repo", repo, "--state", "open", "--limit", "200",
    "--search", `${PARENT_TAG.search(parent)} in:body`,
    "--label", label,
    "--json", "number,body",
  );
  if (code !== 0) return [];
  try {
    const issues = JSON.parse(stdout || "[]") as { number: number; body?: string }[];
    // The search is a prefilter, not the predicate: GitHub tokenizes, so a query for
    // `atomaton:parent=5` also returns the sub-issues of #50. `PARENT_TAG.read` is
    // anchored on the tag's real wire format. Same trap as `aggregate_sub_issues.ts`.
    return issues.filter((i) => PARENT_TAG.read(i.body ?? "") === parent).map((i) => i.number);
  } catch {
    return [];
  }
}

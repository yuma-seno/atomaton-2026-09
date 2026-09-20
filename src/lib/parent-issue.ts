/**
 * parent-issue.ts — the one reader for "which issue is this one a child of".
 *
 * There were three, and they disagreed. `branch-placement.ts` read the body's
 * `atomaton:parent` tag; `aggregation.ts` read the same tag through its own copy of
 * the same `gh` call; `scripts/resolve_orchestrator_parent.ts` issued its own
 * GraphQL query for GitHub's native sub-issue `parent` field and fell back to the
 * tag. Nothing recorded why one of the three had the richer rule.
 *
 * ## Why the tag is gone
 *
 * It answered the same question as GitHub's own sub-issue link, and the two could
 * disagree with nothing to say so. `create_issue` wrote the tag once, at creation,
 * and nothing ever rewrote it; the native link is a person's to change in the web UI
 * at any time. Re-parent a sub-issue there and `parentIssueOf` followed the new
 * parent while `sibling-check.ts` and `work-tree.ts` went on counting under the old
 * one — two answers, both confident.
 *
 * Measured on this repository before choosing: of the eight issues carrying the tag,
 * six agreed with the native link and two had no link at all — one typed in by hand,
 * one an issue merely filed DURING a run on #42 rather than a child of it, which is
 * the other thing the tag had come to mean. Nothing disagreed. So the link is what
 * survives, and `addSubIssue` is no longer best-effort: `create_issue` fails if it
 * cannot establish one, because there is now nothing else recording the edge.
 *
 * The pull request half of the edge — `atomaton:parent-issue` — stays, and that
 * asymmetry is measured too. See `lib/tags.ts`.
 *
 * Not `issueLinks`, which answers a much larger question: it pulls fifty children
 * and fifty pull requests, and every caller here wants one number.
 */
import { ghGraphqlRead } from "./gh.ts";

/**
 * What an issue's parentage turned out to be.
 *
 * Three answers, not two. `known: true, parent: 0` is a root issue; `known:
 * false` is a read that failed, and the two are not interchangeable -- one
 * caller can treat an unknown parent as absent and another cannot. See
 * `stackedPrBase` in `branch-placement.ts` for the case that cannot: it decides
 * where a pull request merges to, and guessing lands one child's half of a
 * feature on the release branch.
 */
export type ParentIssue = { known: true; parent: number } | { known: false; why: string };

function log(message: string): void {
  console.error(`[atomaton-parent] ${message}`);
}

/**
 * The parent issue this one was split out of.
 *
 * GitHub's own sub-issue link, and nothing else. No parent is `parent: 0` — a root
 * issue — and a query that could not be answered is `known: false`, which is the
 * distinction this type exists for.
 *
 * A failure used to fall through to the tag, so a transient error read as "no
 * native parent" and the tag answered. With the tag gone there is nothing to fall
 * through to, which is why the read retries: see `ghGraphqlRead`. Only a failure
 * that outlasts the retries is `known: false`.
 */
export function parentIssueOf(repo: string, issue: number): ParentIssue {
  const [owner, name] = repo.split("/", 2);
  if (!owner || !name) {
    const why = `'${repo}' is not an owner/name repository, so #${issue}'s parent could not be asked for`;
    log(`WARN ${why}`);
    return { known: false, why };
  }

  try {
    const data = ghGraphqlRead<{ repository: { issue: { parent: { number: number } | null } } }>(
      "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){parent{number}}}}",
      { owner, repo: name, num: issue },
    );
    return { known: true, parent: data.repository.issue.parent?.number ?? 0 };
  } catch (error) {
    const why = `could not read the parent of #${issue}: ${(error as Error).message}`;
    log(`WARN ${why}`);
    return { known: false, why };
  }
}

/**
 * git-tags.ts — the repository's tags, as GitHub has them.
 *
 * Not `git tag`. A deployment creates a tag by asking GitHub — `gh release create`
 * is the usual way — so the tag exists on the remote and not in the runner's
 * checkout, which was shallow and is now stale besides. The only place the answer
 * lives is the API.
 *
 * One reader, because `plan_deploy.ts` takes the "before" and
 * `dispatch_new_tags.ts` takes the "after", and a difference between two lists is
 * only meaningful when both were gathered the same way. Two readers that paginated
 * differently would report a tag as new on the first run past the page boundary.
 */
import { gh } from "./gh.ts";

/**
 * Every tag name in the repository, or null when they could not be read.
 *
 * Null rather than `[]`: an empty list means "this repository has no tags", and a
 * failed read means "no tag can be reported as new". Collapsing them would make a
 * failed read look like a repository that had just created every tag it has.
 *
 * `--paginate`, because a repository with more than a hundred tags is ordinary and
 * a truncated first page would report the tags beyond it as new on the next run.
 */
export function readTagNames(repo: string): string[] | null {
  const { code, stdout } = gh("api", "--paginate", `repos/${repo}/git/matching-refs/tags`, "--jq", ".[].ref");
  if (code) return null;
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("refs/tags/"))
    .map((line) => line.slice("refs/tags/".length));
}

/**
 * Tags present in `after` and not in `before`, in the order `after` reports them.
 *
 * Pure, and separate from the read, because it is the whole of the decision: a run
 * dispatches exactly the tags it is about to name, and a set difference is a thing
 * that can be got wrong silently.
 */
export function tagsAdded(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before);
  return after.filter((tag) => !known.has(tag));
}

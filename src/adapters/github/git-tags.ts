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
  const tags = readTags(repo);
  return tags === null ? null : tags.map((tag) => tag.name);
}

/** One tag, and the commit it points at. */
export interface RepositoryTag {
  readonly name: string;
  readonly sha: string;
}

/**
 * Every tag with the commit it points at, or null when they could not be read.
 *
 * The sha is what decides whether a tag is deployable: a tag is a name for a commit,
 * and the question every deployment asks is about that commit, not about the name.
 *
 * An annotated tag's ref points at the tag OBJECT rather than at the commit, so
 * `object.sha` is not always a commit sha. `compare` resolves either, which is why
 * the sha travels raw rather than being dereferenced here — dereferencing would be a
 * second API call per tag to learn something the caller's one call already handles.
 */
export function readTags(repo: string): RepositoryTag[] | null {
  const { code, stdout } = gh(
    "api", "--paginate", `repos/${repo}/git/matching-refs/tags`, "--jq", '.[] | "\\(.ref) \\(.object.sha)"',
  );
  if (code) return null;
  return stdout
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter(([ref, sha]) => ref?.startsWith("refs/tags/") && sha)
    .map(([ref, sha]) => ({ name: (ref as string).slice("refs/tags/".length), sha: sha as string }));
}

/**
 * The commits `after` has that `before` did not, or null when they could not be read.
 *
 * A push event carries both ends, so "what arrived with this push" needs no memory of
 * previous runs — the event is the delta. That is what lets a tag deploy at the
 * moment a merge makes its commit reviewed, without anything anywhere holding a list
 * of tags waiting to become eligible.
 *
 * An empty `before` — a branch created by this push — has no delta to compute and
 * answers with nothing rather than with every commit in history.
 */
export function commitsAdded(repo: string, before: string, after: string): string[] | null {
  if (!before || !after || /^0+$/.test(before)) return [];
  const { code, stdout } = gh("api", "--paginate", `repos/${repo}/compare/${before}...${after}`, "--jq", ".commits[].sha");
  if (code) return null;
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Whether `commit` is contained in `branch` — null when the question could not be
 * answered.
 *
 * `behind` means the head is an ancestor of the base, `identical` that they are the
 * same commit; both mean the commit is inside the branch. Measured against this
 * repository: `main...v0.1.157` answers `behind`, and a squash-merged pull request's
 * own head answers `diverged`, because a squash writes a new commit and leaves the
 * branch's commits outside.
 */
export function isContained(repo: string, branch: string, commit: string): boolean | null {
  const { code, stdout } = gh("api", `repos/${repo}/compare/${branch}...${commit}`, "--jq", ".status");
  if (code) return null;
  const status = stdout.trim();
  return status === "behind" || status === "identical";
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

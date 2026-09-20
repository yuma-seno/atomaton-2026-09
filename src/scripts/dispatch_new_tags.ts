#!/usr/bin/env bun
/**
 * dispatch_new_tags.ts — start a deploy run for each tag this run's deployments
 * created.
 *
 * The fifth instance of the hole `lib/dispatch-targets.ts` opens by naming four:
 * **GitHub starts no workflow run for events its own token triggers.** A deployment
 * that cuts a release creates its tag with GITHUB_TOKEN, from inside a workflow, so
 * no `push` arrives and `on_tag` never fires. A project could write a perfectly good
 * `on_tag` entry and watch it never run — which is exactly this repository's own
 * shape, where `scripts/tag-release.sh` tags every release.
 *
 * The run that created the tag is the only thing that knows it is new, so that run
 * dispatches: `--ref <tag>`, `trigger=tag`, once per tag, in the order GitHub lists
 * them.
 *
 * ## Why this is a job of its own
 *
 * Because dispatching needs `actions: write`, and the job that runs a project's
 * deployment commands must not have it. That job already holds `contents: write`
 * and whatever credentials the entry declared; adding `actions: write` would let a
 * command a project wrote start any workflow in the repository. The comparison is
 * cheap and the privilege is not, so the two are separated: the planning job takes
 * the "before" list, this job takes the "after" and dispatches.
 *
 * The cost of that split is a window. Between the plan and this job, another run
 * deploying a different ref could create a tag, and this run would dispatch for it
 * too — one extra deploy of a tag that did want deploying, rather than a missed one.
 * A deployment is expected to be idempotent for the same reason `on_merge` is: it
 * runs after every merge and most of them change nothing.
 *
 * ## Failing rather than warning
 *
 * A dispatch that does not happen is a production deployment that does not happen,
 * and the whole point of this script is that nothing else would notice. So an
 * unreadable tag list and a refused dispatch are both errors, and every tag is
 * attempted before the run fails, so one bad name does not hide the rest.
 *
 * ## Why the "before" list arrives in the environment
 *
 * Because it is a list, and a repository with five hundred tags has a five-hundred
 * element argv. An environment variable carries it whole, the workflow already has
 * it in one, and a JSON array full of quotes stops being something every shell on
 * every platform has to agree about how to quote — Windows, where this repository
 * is developed, refuses to pass a `"` to a `.cmd` at all.
 *
 * Usage:
 *   ATOMATON_TAGS_BEFORE='["v1.0.0"]' dispatch_new_tags.ts --repo owner/name
 */
import { parseArgs } from "node:util";
import { DEFAULT_CD_WORKFLOW } from "../domain/shipped-workflows.ts";
import { gh } from "../lib/gh.ts";
import { readTagNames, tagsAdded } from "../lib/git-tags.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface DispatchNewTagsArgs {
  /** `owner/name`. */
  repo: string;
}

/** Where the tags that existed before the deployments ran arrive, as JSON. */
export const TAGS_BEFORE_VAR = "ATOMATON_TAGS_BEFORE";

export const ref = defineScript<DispatchNewTagsArgs>(import.meta.url);

/** The "before" list, or null when it is not one this can compare against. */
export function parseBefore(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

function main(): void {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { repo: { type: "string" } },
  });
  const repo = (values.repo ?? "").trim();
  if (!repo) {
    console.error("::error::dispatch_new_tags: no --repo was given, so no tag could be deployed.");
    process.exit(1);
  }

  const before = parseBefore(process.env[TAGS_BEFORE_VAR] ?? "");
  if (before === null) {
    console.error(
      `::error::dispatch_new_tags: ${TAGS_BEFORE_VAR} was not a JSON array of tag names, so nothing could be compared.`,
    );
    process.exit(1);
  }

  const after = readTagNames(repo);
  if (after === null) {
    console.error("::error::The repository's tags could not be read, so a tag this deployment created would not be deployed.");
    process.exit(1);
  }

  const added = tagsAdded(before, after);
  if (added.length === 0) {
    console.error("This deployment created no tags.");
    return;
  }

  let failed = 0;
  for (const tag of added) {
    const { code, stdout, stderr } = gh(
      "workflow", "run", DEFAULT_CD_WORKFLOW, "--repo", repo, "--ref", tag, "-f", "trigger=tag",
    );
    if (code) {
      failed += 1;
      console.error(`::error::Could not start a deployment for the new tag ${tag}: ${stderr || stdout}`);
      continue;
    }
    console.error(`Started a deployment for the new tag ${tag}.`);
  }
  if (failed > 0) process.exit(1);
}

if (import.meta.main) main();

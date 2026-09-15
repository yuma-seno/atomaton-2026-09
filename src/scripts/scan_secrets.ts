#!/usr/bin/env bun
/**
 * scan_secrets.ts — scan this branch's own commits for leaked credentials.
 *
 * Shipped as a default check, and it is the one kind of verification a template
 * can hand every adopter: a credential is a credential in every language, so
 * this needs to know nothing about what the project is written in. The commands
 * beside it in `checks.commands` are the project's own and only the project can
 * write them.
 *
 * ## Why this branch's commits and not the history
 *
 * An old finding is not something this pull request can fix, and failing every
 * pull request over one teaches people to ignore the check — which costs more
 * than the check was ever worth. Scan history deliberately, by hand, when you
 * want to know. This exists to stop a credential being added today.
 *
 * That is also what makes it safe to turn on by default in a repository that
 * already has years of commits behind it. It cannot fire on anything that was
 * already there.
 *
 * ## Why the latest gitleaks rather than a pinned one
 *
 * The value of a secret scanner is its rule set, and pinning freezes it at
 * whatever was current the day someone wrote the number down. A project that
 * would rather review each update can pin it here.
 *
 * Usage:
 *   scan_secrets.ts
 */
import { gh, gitRun } from "../lib/gh.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

function log(message: string): void {
  console.error(`[scan-secrets] ${message}`);
}

/** The commits this branch adds, as a range gitleaks can be pointed at. */
function branchRange(): string | undefined {
  // `atoma-check.yml` checks out shallow, and a merge base cannot be computed
  // from one commit. Tolerated rather than required: a repository that is
  // already complete refuses to unshallow, which is not a failure.
  gitRun("fetch", "--quiet", "--unshallow", "origin");

  // A pull request sets GITHUB_BASE_REF; a dispatch -- the agent path -- does
  // not, and falls back to the default branch, which is where their branches
  // start.
  const base = (process.env.GITHUB_BASE_REF || process.env.ATOMA_BASE_BRANCH || "main").trim();
  if (gitRun("fetch", "--quiet", "origin", base).code !== 0) {
    log(`could not fetch ${base}; scanning nothing rather than guessing at a range`);
    return undefined;
  }
  const mergeBase = gitRun("merge-base", "FETCH_HEAD", "HEAD");
  if (mergeBase.code !== 0 || !mergeBase.stdout) {
    log(`no merge base with ${base}; scanning nothing rather than guessing at a range`);
    return undefined;
  }
  return `${mergeBase.stdout.trim()}..HEAD`;
}

function run(cmd: string[]): number {
  return Bun.spawnSync({ cmd, stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
}

function main(): void {
  const range = branchRange();
  // Nothing to compare against is not a leak. Saying so and passing is right:
  // the alternative blocks a pull request for a property of the checkout.
  if (range === undefined) return;
  console.log(`Scanning ${range}`);

  const release = gh("api", "repos/gitleaks/gitleaks/releases/latest", "--jq", ".tag_name");
  if (release.code !== 0 || !release.stdout.trim()) {
    // Not a failure of the branch. A rate limit or an outage at the far end
    // must not read as "this pull request added a credential".
    console.log(
      "::warning::could not resolve the latest gitleaks release, so this branch was not scanned for credentials",
    );
    return;
  }
  const tag = release.stdout.trim();
  const url = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/gitleaks_${tag.replace(/^v/, "")}_linux_x64.tar.gz`;

  if (run(["bash", "-c", `curl -sSfL "${url}" | tar -xz -C /tmp gitleaks`]) !== 0) {
    console.log(`::warning::could not download gitleaks ${tag}, so this branch was not scanned for credentials`);
    return;
  }

  const found = run(["/tmp/gitleaks", "git", `--log-opts=${range}`, "--redact", "--verbose", "--no-banner", "."]);
  if (found !== 0) {
    console.error("::error::gitleaks found a credential in this branch's commits. The output above says where.");
    process.exit(found);
  }
}

if (import.meta.main) main();

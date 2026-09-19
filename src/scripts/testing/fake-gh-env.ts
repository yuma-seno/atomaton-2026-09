/**
 * fake-gh-env.ts — put the fake `gh` where a spawned process will actually find it.
 *
 * Shared by `harness.ts` and `tests/e2e/fake-gh.ts`, which both need the same thing and
 * had the same two bugs, because they had the same two lines.
 *
 * ## What went wrong
 *
 * The fake was `testing/bin/gh`, an extensionless file, and the directory holding it
 * was prepended as `` `${dir}:${process.env.PATH}` ``.
 *
 * Both halves are POSIX-only. Windows separates PATH entries with `;`, so that string
 * was not a path list at all; and Windows resolves a bare command through PATHEXT, so
 * a file with no extension is not a program there whatever list it is on. The fake was
 * therefore never once invoked on Windows.
 *
 * **What ran instead was the real `gh`, with the developer's own credentials.** Most
 * tests then failed on answers that did not match their fixtures, which read as
 * "subprocess tests do not work on this machine" and was believed for weeks. The ones
 * that did not set `GITHUB_REPOSITORY`, running scripts that post with no `--repo`,
 * resolved the repository from the checkout's remote and wrote to it: 113 comments on
 * one issue of this repository, 12 of them in a single afternoon.
 *
 * ## Two fixes, because one of them is not enough
 *
 * The shim below makes the fake resolvable on both platforms. That is the repair.
 *
 * The rest is the guard: the real `gh` is left with no usable credentials and no
 * repository, so a future bypass **fails** rather than quietly working against the live
 * repository. An isolation that degrades into the real thing is the shape this
 * codebase keeps finding — a check whose input is missing answering "fine" — and the
 * answer is the same one: when the thing that makes this safe is absent, nothing
 * should succeed.
 *
 * `hermeticEnv` deliberately leaves the tokens alone, and that stays true of it: it
 * describes the ambient environment, and CI has tokens. This is narrower — it is the
 * environment of a process that is supposed to be talking to a fake — and there the
 * token is not context, it is the thing that makes a mistake expensive.
 */
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The fake's behaviour. Launched through the shim below rather than executed directly. */
export const FAKE_GH_IMPL = join(HERE, "bin", "gh");

/**
 * The environment that points a child process — and everything it spawns — at the fake.
 *
 * `binDir` is the caller's own temp directory, used for `gh`'s config so the real CLI
 * has nothing of the developer's to read even if it is somehow reached.
 */
export function fakeGhEnv(
  binDir: string,
  rules: unknown,
  logPath: string,
): Record<string, string> {
  return {
    // Named, not resolved. See `ghCommand` in `lib/gh.ts`: PATH cannot carry this on
    // Windows, and the way it failed was to fall through to the real CLI.
    ATOMATON_FAKE_GH: FAKE_GH_IMPL,
    FAKE_GH_RESPONSES: JSON.stringify(rules ?? []),
    FAKE_GH_LOG: logPath,
    // The guard, and the reason it is not redundant. If a future change reaches the
    // real `gh` anyway, it finds no usable token and none of the developer's config,
    // and fails — instead of succeeding against this repository.
    GH_TOKEN: "fake-gh-must-be-used",
    GITHUB_TOKEN: "fake-gh-must-be-used",
    GH_CONFIG_DIR: binDir,
  };
}

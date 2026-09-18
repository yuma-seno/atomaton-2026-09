/**
 * live-tools-check.test.ts — where the live tool check is wired, and the one place
 * it must never be.
 *
 * ## The two halves, and why they are pinned together
 *
 * `atoma validate --with-live-tools` starts the servers a definition names. That
 * makes it the one check in this system that EXECUTES configuration, and it
 * therefore cannot run where a pull request's configuration is the input:
 * `validate_deliverable.ts` reads `.github/atomaton/` as data and runs nothing under
 * `--root`, and `tools.servers` lets anyone write an arbitrary `command`. Wiring it
 * there would turn "a check that runs nothing" into "a check that runs the pull
 * request", inside the job that decides whether that pull request may merge.
 *
 * So it is wired at the other end: `scripts/release.sh`, on the default branch,
 * against `dist/` — the artifact about to be published. These tests hold both
 * ends, because either one alone is half a rule: the check existing is useless if
 * nothing calls it, and the check being called is dangerous if it is called from
 * the pull request path.
 *
 * ## Why ordering is asserted rather than described
 *
 * `release.sh` builds the artifact with `bun run synth` and publishes it with
 * `gh release create`. The check has to sit between them: before the build there
 * is no `dist/` to check (it is gitignored, so a fresh checkout has none), and
 * after the publish a failure would arrive too late to withhold anything. Both
 * directions are silent — a check that ran first would fail on a missing
 * directory, and one that ran last would leave the release standing — so the order
 * is pinned here rather than left to whoever next edits the script.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const CHECK = "scripts/check-live-tools.sh";
const RELEASE = "scripts/release.sh";
const DELIVERABLE_VALIDATOR = "src/scripts/validate_deliverable.ts";

function body(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

describe("the live tool check", () => {
  test("exists, and is a shell script this repository owns", () => {
    expect(existsSync(CHECK), `${CHECK} is missing; nothing calls --with-live-tools`).toBe(true);
    expect(body(CHECK).startsWith("#!/usr/bin/env bash")).toBe(true);
    // Executable, because the deploy runs it as a program. It is invoked through
    // `bash` below as well, so losing the bit is not fatal -- but a file that is
    // only ever invoked explicitly is one nobody notices has stopped being runnable.
    if (process.platform !== "win32") {
      expect(statSync(CHECK).mode & 0o111, `${CHECK} is not executable`).not.toBe(0);
    }
  });

  test("it asks atoma the question that needs live servers", () => {
    const source = body(CHECK);
    // Both flags: `--with-live-tools` without a tools file is refused by atoma, and
    // a script that lost either one would report a clean pass having asked nothing.
    expect(source, "the check must ask the live question").toContain("--with-live-tools");
    expect(source, "the live question needs the tools file").toContain("--tools-file");
  });

  /**
   * The binary it checks with is the one a run installs.
   *
   * `--with-live-tools` only exists from atoma v0.1.37, and the checks are the
   * BINARY's rather than this repository's — so a check run against an older or
   * other binary answers a different question while looking identical. The pin is
   * read from `actions/atoma-cli.ts` rather than repeated, so raising it cannot
   * leave this quietly checking something else.
   */
  test("the version is read from the pin, not written a second time", () => {
    const source = body(CHECK);
    expect(source, "the pin is the single declaration of which binary runs").toContain("ATOMA_DEFAULT_VERSION");
    expect(source).toContain("src/workflows/actions/atoma-cli.ts");
    // The download URL is built from what was read, so there is no tag literal to
    // drift away from the pin.
    expect(source).toContain("releases/download/${VERSION}/atoma-linux-x86_64");
    // And a fetch that fails must fail the check. `curl` without `-f` writes the
    // error page to the file and exits 0, which is the shape this guards against:
    // the binary would then be un-runnable and the script would carry on.
    expect(source, "curl must fail the step on an HTTP error").toContain("curl -fsSL");
  });

  /**
   * `dist/` and never `.github/`.
   *
   * `.github/` in this repository is the last RELEASE, put there by the self-deploy
   * workflow, so it is a copy of something that already passed this check. `dist/`
   * is built from the default branch by the step above and is what an adopter
   * receives — which is the only tree whose consistency is worth asking about.
   */
  test("it checks the artifact about to be published", () => {
    const source = body(CHECK);
    expect(source, "the artifact, not the last release").toContain('MACHINERY="$REPO_ROOT/dist"');
    expect(source, "the last release is not the thing being shipped").not.toContain('MACHINERY="$REPO_ROOT/.github"');
    // A tools file written from the tree being checked, not one left behind: the
    // file stopped shipping when it became a per-run artifact.
    expect(source, "the tools file must be generated from that tree").toContain("write_tools_file.ts");
  });

  /**
   * Every definition, not a chosen one.
   *
   * A server only the orchestrator names is still a server this release hands an
   * adopter, and a `for` over the directory is what makes a fourth definition
   * covered without anyone remembering to add it here.
   */
  test("it validates every definition the artifact ships", () => {
    const source = body(CHECK);
    expect(source, "a hard-coded definition name would skip the rest").toContain('for def in "$DEFS_DIR"/*.md');
  });
});

describe("where it is wired", () => {
  /**
   * The ordering, in `release.sh` itself.
   *
   * Three positions, and each pair of them matters: build before check (there is
   * no `dist/` before the build), check before publish (after it, the failure
   * cannot withhold anything), and the check present at all (otherwise the flag
   * exists and nothing runs it — which is the state this whole change is about).
   */
  test("release.sh runs it after building the artifact and before publishing it", () => {
    const source = body(RELEASE);
    const check = source.indexOf("check-live-tools.sh");
    const build = source.indexOf("bun run synth");
    const publish = source.indexOf("gh release create");

    expect(check, "release.sh does not run the live tool check, so nothing does").toBeGreaterThan(-1);
    expect(build, "release.sh no longer builds the artifact").toBeGreaterThan(-1);
    expect(publish, "release.sh no longer publishes a release").toBeGreaterThan(-1);

    expect(build, "the check would run before there is a dist/ to check").toBeLessThan(check);
    expect(check, "a failure after the publish withholds nothing").toBeLessThan(publish);

    // And below the early exit, so it runs when a release is being CUT rather than
    // on every merge. That is the deliberate half of the cost: a merge that breaks
    // a guard without bumping the version is not caught until the release that
    // ships it. Moving the check above this exit would start servers on every
    // merge, which is a different decision and should not be an accidental one.
    const alreadyReleased = source.indexOf("is already released; nothing to do");
    expect(alreadyReleased, "release.sh no longer stops early for an existing release").toBeGreaterThan(-1);
    expect(
      alreadyReleased,
      "the live tool check now runs on every merge; keeping it below the early exit runs it when a " +
        "release is actually being cut",
    ).toBeLessThan(check);
  });

  /**
   * And the pull request path stays free of it.
   *
   * This is the constraint the issue names as immovable, and it is the one an
   * edit could undo by accident: the flag is one line, and putting it next to the
   * other `atoma validate` call is exactly what looks natural. The guarantee is
   * that nothing under `--root` is executed, so the validator must not gain it —
   * and neither must the workflow that invokes the validator, which is where the
   * pull request's own tree is checked out.
   */
  test("the deliverable check never starts a server", () => {
    const validator = body(DELIVERABLE_VALIDATOR);
    expect(
      validator.includes("--with-live-tools"),
      "validate_deliverable.ts reads a pull request's `.github/atomaton/` as data and runs nothing " +
        "under --root. Starting the servers that tree declares would execute the pull request inside " +
        "the job that judges it.",
    ).toBe(false);

    for (const workflow of [
      "src/workflows/atomaton-validate-pr.wac.ts",
      "dist/.github/workflows/atomaton-validate-pr.yml",
    ]) {
      // `dist/` is gitignored, so a fresh checkout has none until synth runs. CI
      // builds it before `test`; locally the source above is still checked.
      if (!existsSync(workflow)) continue;
      expect(
        body(workflow).includes("--with-live-tools"),
        `${workflow} runs the pull request validation, and must not start the servers a pull request declares`,
      ).toBe(false);
    }
  });

  /**
   * And the wiring is this repository's own, which is what the adopter-facing
   * documentation now says.
   *
   * `docs/operations.md` tells an adopter in the second person that no shipped file
   * references this check, so their release does not run it. That sentence is true
   * only while nothing under `src/` or `self/` names it — `src/` is what
   * `build-dist.ts` copies into `dist/`, and `self/` is this repository's own
   * overlay. If someone wires it into the shipped template, this test fails and the
   * documentation has to be corrected in the same change rather than quietly
   * becoming false for every reader of the delivered docs.
   *
   * `src/atomaton-runtime/tools/defaults.yaml` is the sharp case, because it ships
   * and an adopter is told to read it: it may mention `--with-live-tools` as
   * something a project can wire, and must not claim the check runs for them.
   */
  test("nothing shipped references the check, which is what the docs promise", () => {
    const referencing = [...walk("src"), ...walk("self")].filter((path) =>
      body(path).includes("check-live-tools.sh"),
    );
    expect(
      referencing,
      "the delivered template now references the live tool check. `docs/operations.md` tells an " +
        "adopter their release does not run it unless they wire it themselves; either that " +
        "documentation must change with this, or the reference does not belong in a shipped tree.",
    ).toEqual([]);
  });

  /**
   * And the shipped file that DOES mention the flag says who runs it.
   *
   * `src/atomaton-runtime/tools/defaults.yaml` is copied into `dist/` and carried by
   * the release zip, and `.github/atomaton/README.md` tells an adopter it is there to
   * be read. Its `files_readonly` comment mentions `--with-live-tools`, which is
   * fine as something a project can wire and false as a property of their release:
   * the only caller is this repository's `scripts/release.sh`, and `scripts/` is not
   * in the archive. So the mention has to be accompanied by the part that is true
   * for that reader — that nothing runs it for them.
   */
  test("the shipped comment about the flag does not claim a check the reader has", () => {
    const shipped = body("src/atomaton-runtime/tools/defaults.yaml");
    expect(shipped, "the shipped defaults no longer mention the flag; drop this test").toContain("--with-live-tools");

    // Comment markers and wrapping stripped, so the claim is checked as the prose a
    // reader sees rather than as lines it happens to be broken across.
    const prose = shipped
      .replace(/^\s*#\s?/gm, "")
      .replace(/\s+/g, " ");

    expect(
      prose,
      "src/atomaton-runtime/tools/defaults.yaml ships to every adopter, and the only caller of " +
        "--with-live-tools is this repository's scripts/release.sh, which is not in the archive. " +
        "The comment may offer the flag as something a project can wire, and must say that nothing " +
        "runs it for that reader.",
    ).toMatch(/\b(?:nothing|nobody|no one)\s+(?:runs|invokes|executes)\s+it\b/i);

    expect(
      prose,
      "the shipped comment now describes this repository's release wiring as if it were the " +
        "reader's. `scripts/` is not in the release archive, so an adopter has no such check.",
    ).not.toMatch(/before a release ships|artifact being published|release\.sh/);
  });

  /**
   * And the adopter-facing page says the same thing about the reader's release.
   *
   * `docs/` is written to an adopter, and the page that describes "the jobs you will
   * see" told them the live half "runs … in the release" — as if it were coverage
   * they had. It is not: `src/atomaton/config.yaml` ships `targets: []`, no shipped
   * file names the check, and the file names such a paragraph uses (`scripts/`,
   * `dist/`) do not exist in an adopter's tree. This is the same class of failure
   * `config-contract.test.ts` exists for — a page that fails a reader for following
   * it — one step earlier: a page that lets them believe a check is running.
   */
  test("the adopter-facing page does not claim the reader's release runs it", () => {
    const prose = body("docs/operations.md").replace(/\s+/g, " ");
    expect(prose, "the page no longer mentions the check; drop this test").toContain("--with-live-tools");
    expect(
      prose,
      "docs/operations.md is written to an adopter. It may offer the flag as something they can " +
        "wire, and must say that nothing delivered runs it — the shipped config has `targets: []` " +
        "and no shipped file references scripts/check-live-tools.sh.",
    ).toMatch(/\b(?:nothing delivered|no shipped file|the template does not|shipped pipeline does not)\b/i);
    // And the two phrasings that were wrong, so that adding the sentence above while
    // leaving the claim standing is still a failure: "in the release" and "a release
    // starts the servers it would ship" both read as coverage the adopter has.
    expect(
      prose,
      "the page describes the live half as running in the reader's release. It runs in THIS " +
        "repository's release, from scripts/release.sh, which is not in the archive an adopter " +
        "receives — say so rather than leaving the claim unqualified.",
    ).not.toMatch(/in the release|a release starts the servers it would ship/i);
  });
});

/**
 * Every text file under a directory, so a claim about "nothing shipped references
 * this" is checked rather than asserted.
 */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...walk(path));
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|sh|yaml|yml|md|json)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

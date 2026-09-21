/**
 * adopter-terms.test.ts — nothing an adopter reads describes THIS repository in
 * place of theirs.
 *
 * ## The failure this exists for
 *
 * `src/content/**` is copied verbatim into an adopter's `.github/atomaton/`, and
 * `docs/**` is what they read about it. Neither audience has a build output tree,
 * runs the generator, dispatches the self-deploy workflow, cuts a release of this
 * template, or can open an issue by a number written here. A sentence that names
 * one of those is not merely irrelevant to them: it is an instruction they cannot
 * follow and a guarantee they do not have.
 *
 * The rule itself was written down long before this test — in the project
 * conventions skill, which says the shipped tree "may only contain content that
 * holds for any project using Atomaton". Three documentation splits then removed
 * these leaks by hand and left two pages untouched, because nothing failed when
 * one was missed. That is the same defect the documentation issue was opened
 * about: a fact kept only in people's heads goes stale with nothing saying so.
 *
 * ## Which trees, and why each one
 *
 * - `docs/**` — read by somebody standing in their own repository, rendered from
 *   this one. Both referents are in the room at once, which is what makes the
 *   wording rule below apply here and not in the shipped tree.
 * - `src/content/**` — the text that lands in their tree. It is read from inside
 *   their repository, by a person in `.github/atomaton/` and by an agent whose
 *   checkout IS that repository.
 *
 * `.github/**` is deliberately not checked. It is this repository's adoption of a
 * published release, put there by the self-deploy job. A hit there would be a fact
 * about a release that already shipped, and the fix would be a hand-edit of a
 * generated tree, which is the one thing that layout forbids. The overlay tree is
 * not checked for the opposite reason: it is this repository's own and nothing in
 * it ships.
 *
 * `docs/template/architecture.md` is exempt. It is the single page whose declared
 * subject is the template's own source, and `docs/README.md` sends the reader
 * there saying so. Everything the sweep removed from other pages either already
 * lived there or was deleted.
 *
 * ## What this cannot see
 *
 * A paragraph that describes this repository's situation without naming any of
 * these — "the deploy job opens a pull request and merges nothing" — passes. A
 * regex reads names, not subjects. The token list is the floor, not the rule.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";

/** The one page whose subject is the template's own source. */
const EXEMPT = "docs/template/architecture.md";

type Rule = {
  /** What a hit looks like. */
  readonly pattern: RegExp;
  /** Why an adopter cannot act on it. Quoted back in the failure message. */
  readonly why: string;
  /** Left out of the shipped tree, where the phrase has a single referent. */
  readonly docsOnly?: boolean;
};

/**
 * Each entry is a name that exists here and not in an adopted repository.
 *
 * The list is deliberately narrow. Three of the obvious candidates are NOT in it:
 *
 * - `atomaton-data` — the run creates that orphan branch in whatever repository
 *   it works in, so an adopter has one. Sessions, the workspace and the issue
 *   index are theirs, and the pages that say so are correct.
 * - the bare `yuma-seno/atomaton` slug — downloading a release with
 *   `gh release download -R`, and linking to a published docs page, are how an
 *   adopter reaches upstream. What is banned is a link into this repository's own
 *   issues, pull requests, runs or commits, which name work they cannot see. The
 *   same goes for `examples/` — a file they copy from upstream, not a path in
 *   their tree.
 * - a bare `src/` — an adopter may well have one, and a `merge.governed_paths` or
 *   `checks` example may well name it. What is banned is `src/` followed by one of
 *   Atomaton's own layer directories, which is the form that can only mean this
 *   repository's tree.
 *
 * A pattern that fired on an innocent sentence would be weakened by whoever met
 * it next, so each one is written to match only the leak.
 */
const RULES: readonly Rule[] = [
  {
    pattern: /\bdist\//,
    why: "the build output of this repository. It is gitignored here and does not exist there at all",
  },
  {
    pattern: /bun run synth|build-dist\.ts/,
    why: "the generator that builds the deliverable. An adopter receives the built tree and has nothing to run it with",
  },
  {
    pattern: /\bwac\.config\.ts\b|\.wac\.ts\b/,
    why: "the workflow generator's own input. An adopter receives generated YAML under `.github/workflows/`",
  },
  {
    pattern: /\bsrc\/(domain|shared|app|adapters|entrypoints|content|workflows)\//,
    why: "a directory of this repository's source tree, as the architecture page lists them. An adopter receives `.github/`, and none of these",
  },
  {
    pattern: /\btests\/contract\//,
    why: "this repository's own test suite. An adopted repository does not receive it, so naming one promises a check they do not have",
  },
  {
    pattern: /\bself\//,
    why: "this repository's overlay onto its own `.github/`. Nothing in it ships",
  },
  {
    pattern: /self-deploy|SELF_DEPLOY_TOKEN/,
    why: "the workflow that applies a release to this repository, and the credential it needs. An adopter's change takes effect on the next run instead",
  },
  {
    pattern: /(publish|tag)-release\.sh|check-live-tools\.sh/,
    why: "this repository's own release scripts. An adopter's `deploy` ships empty and runs nothing until they wire it",
  },
  {
    pattern: /(^|[\s(])#\d{1,4}\b/,
    why: "an issue or pull request number of this repository. In their tree that number is somebody else's work entirely",
  },
  {
    pattern: /github\.com\/yuma-seno\/[^\s)]*\/(issues|pull|actions|commit)/,
    why: "a link into this repository's own issues, pull requests, runs or commits",
  },
  {
    pattern: /hws-yuma-seno/,
    why: "one person's account on this repository",
  },
  {
    pattern: /\bthis repositor(y|y's)\b|\bthis repo\b/i,
    docsOnly: true,
    why:
      "a page rendered from this repository and read by somebody sitting in another one has two " +
      "referents for `this repository`, and the sentence is true of whichever the reader picks. " +
      "Write `your repository`, or name the template. Inside the shipped tree the phrase is fine: " +
      "that text is read from within the adopter's own checkout, where it has one referent",
  },
];

/** Every file under a tree, in a stable order, with `/` separators on any platform. */
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(root);
  return found;
}

/** `file:line: text` for every line a rule matches. */
function hits(file: string, rule: Rule): string[] {
  const lines = readFileSync(file, "utf8").replaceAll("\r\n", "\n").split("\n");
  return lines
    .map((text, i) => ({ text, n: i + 1 }))
    .filter(({ text }) => rule.pattern.test(text))
    .map(({ text, n }) => `${file}:${n}: ${text.trim()}`);
}

describe("what an adopter reads is about their repository", () => {
  const docs = filesUnder("docs").filter((file) => file !== EXEMPT);
  const shipped = filesUnder("src/content");

  test("there are pages to check, and the exempt one is among them", () => {
    expect(docs.length, "docs/ is empty, so this file is checking nothing").toBeGreaterThan(20);
    expect(shipped.length, "the shipped tree is empty, so this file is checking nothing").toBeGreaterThan(5);
    // Named rather than assumed: a rename of the exempt page would otherwise turn
    // this whole file into a check of a tree that no longer has the page in it.
    expect(filesUnder("docs"), `${EXEMPT} is the one exempt page and it is not there any more`).toContain(EXEMPT);
  });

  test.each(RULES.map((rule) => [rule.pattern.source, rule] as const))(
    "no page under docs/ names %s",
    (_source, rule) => {
      const found = docs.flatMap((file) => hits(file, rule));
      expect(found, `${rule.why}:\n  ${found.join("\n  ")}`).toEqual([]);
    },
  );

  test.each(RULES.filter((rule) => !rule.docsOnly).map((rule) => [rule.pattern.source, rule] as const))(
    "nothing shipped into an adopter's tree names %s",
    (_source, rule) => {
      const found = shipped.flatMap((file) => hits(file, rule));
      expect(found, `${rule.why}:\n  ${found.join("\n  ")}`).toEqual([]);
    },
  );
});

/**
 * doc-links.test.ts — every relative link and anchor between documents resolves.
 *
 * ## The failure this exists for
 *
 * `docs/` is about to be split from six flat files into a tree, and the first
 * measurement of that split was that ninety-five links run between these documents.
 * Roughly half name a file and half name a heading inside one. A move breaks them
 * all at once, and a broken link in Markdown is silent: GitHub renders it, it looks
 * like a link, and it 404s only for the reader who follows it.
 *
 * That is exactly the failure the documentation issue was opened for — a document
 * that goes stale with nothing saying so — which makes a split performed without
 * this test an instance of the disease it is meant to cure.
 *
 * ## What it does not check
 *
 * Absolute URLs. A link to `https://github.com/...` may rot, and asking the network
 * would make this test slow and flaky in equal measure. Nothing here leaves the
 * repository.
 *
 * Nor does it check that a link is the RIGHT one: a link to an existing heading
 * that answers a different question passes. Only that what it names is there.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Every Markdown file this repository is the author of. */
function markdownFiles(): string[] {
  const roots = ["docs", "src/content", "self", ".github/atomaton"];
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".md")) found.push(path);
    }
  };
  for (const root of roots) walk(root);
  for (const name of ["README.md", "CONTRIBUTING.md"]) if (existsSync(name)) found.push(name);
  return found;
}

/**
 * The link targets in one file, as written.
 *
 * Inline links only — `[text](target)`. Reference-style definitions are not used
 * anywhere in this repository, and a pattern for a form nobody writes is a pattern
 * nobody maintains.
 *
 * Fenced code is stripped first. A README that SHOWS a Markdown link as an example
 * is not claiming the target exists, and a test that reads an example as a claim is
 * one nobody can satisfy.
 */
function linksIn(source: string): string[] {
  const prose = source.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] ?? "");
}

/**
 * A heading's anchor, as GitHub derives it: lowercased, punctuation dropped, spaces
 * to hyphens. Close enough for the headings this repository writes, and a heading
 * exotic enough to defeat it is one worth rewording rather than encoding for.
 *
 * `_` is kept, and that is not a detail. GitHub's slugger keeps it, and most
 * configuration keys carry one -- `setup_commands`, `max_reloads`,
 * `from_pull_request`, `governed_paths`. Dropping it here would have made every
 * anchor in the key index either fail this test or 404 on GitHub, with no spelling
 * that satisfies both.
 */
function anchorsIn(source: string): Set<string> {
  const prose = source.replace(/```[\s\S]*?```/g, "");
  const anchors = new Set<string>();
  for (const [, hashes, text] of prose.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)) {
    void hashes;
    const slug = (text ?? "")
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (slug) anchors.add(slug);
  }
  return anchors;
}

const files = markdownFiles();

describe("the links between this repository's documents", () => {
  test("there are documents to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  test.each(files)("%s names nothing that is not there", (file) => {
    const source = readFileSync(file, "utf8");
    const broken: string[] = [];

    for (const target of linksIn(source)) {
      // Anything addressed to the outside is somebody else's to keep true.
      if (/^(https?:|mailto:|#)/.test(target)) {
        if (target.startsWith("#")) {
          const anchor = target.slice(1).toLowerCase();
          if (!anchorsIn(source).has(anchor)) broken.push(`${target} (no such heading in this file)`);
        }
        continue;
      }

      const [pathPart = "", anchor] = target.split("#");
      const resolved = resolve(dirname(file), pathPart);
      if (!existsSync(resolved)) {
        broken.push(`${target} (no file at ${relative(".", resolved).replace(/\\/g, "/")})`);
        continue;
      }
      if (anchor && resolved.endsWith(".md")) {
        const anchors = anchorsIn(readFileSync(resolved, "utf8"));
        if (!anchors.has(anchor.toLowerCase())) broken.push(`${target} (no such heading)`);
      }
    }

    expect(broken, `${file} links to:\n  ${broken.join("\n  ")}`).toEqual([]);
  });
});

/**
 * Reachability, which is a different question from whether a link resolves.
 *
 * The move that this file was written to guard did not break one link. It deleted
 * `recipes.md`, whose Contents table was the only thing that named the eighteen
 * recipes -- and eleven of the files it became were then reachable from nowhere. Every
 * link in the repository still pointed at something real. The test above passed.
 *
 * A document nothing links to is one you find by knowing it is there, which is the
 * state the documentation issue was opened about.
 */
describe("every document under docs/ can be reached from another one", () => {
  /** `docs/README.md` is the map. It is reached from the repository's own README. */
  const MAP = "docs/README.md";

  test("nothing under docs/ is orphaned", () => {
    const linked = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const target of linksIn(source)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const resolved = resolve(dirname(file), target.split("#")[0] ?? "");
        // Relative to the repository, and with the separators git uses, so the
        // comparison does not depend on which platform ran the test.
        linked.add(relative(".", resolved).split("\\").join("/"));
      }
    }

    const orphans = files
      .map((f) => f.split("\\").join("/"))
      .filter((f) => f.startsWith("docs/"))
      .filter((f) => f !== MAP)
      .filter((f) => !linked.has(f));

    expect(
      orphans,
      "these are reachable only by knowing they exist. Name them from " +
        `${MAP}, or from the document whose subject they belong to:\n  ` +
        orphans.join("\n  "),
    ).toEqual([]);
  });

  test("the map itself is reached from the repository's README", () => {
    const readme = readFileSync("README.md", "utf8");
    const targets = linksIn(readme).map((t) => t.split("#")[0]);
    expect(targets, `README.md does not link to ${MAP}, so nothing reaches the map`).toContain(MAP);
  });
});

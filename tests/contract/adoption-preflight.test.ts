/**
 * adoption-preflight.test.ts — the setup guide, held to the configuration it is a
 * guide for.
 *
 * This is the one document where being wrong costs the most. It is what someone
 * reads before their first run, and it had drifted into naming a credential the
 * shipped configuration does not use: `OPENAI_API_KEY`, while all three agent
 * definitions read `provider: openrouter-responses` -- the router at the time;
 * they name `orcarouter-responses` now. Since atoma v0.1.13 one
 * provider reads one credential with **no fallback**, so every new adopter
 * following the checklist got a failed first run, on the run that is supposed to
 * prove the adoption worked.
 *
 * ## Where the truth lives
 *
 * The provider table in `docs/agents/reference.md` is the mapping, and this test
 * reads it rather than restating it — so there is no third copy to drift. The
 * chain is: agent definition names a provider, the table says which credential
 * that provider reads, the setup guide must name that credential.
 *
 * The core is authoritative above all of this: the table itself mirrors
 * `PROVIDERS` in atoma's `infra/llm/mod.rs`, and a provider name that atoma does
 * not know is what `atoma validate` should reject. This test
 * covers the half that lives here.
 *
 * ## Why it reads a whole file rather than a section
 *
 * It used to slice the README's "Preflight checklist" and stop at the words "To
 * run somewhere else", because the alternatives were named in prose directly below
 * the required list and naming them there is the point. `docs/setup.md` is the
 * checklist now, and it carries actions only: the alternatives moved to
 * `docs/agents/reference.md`, which this test does not police in that direction. So
 * the whole page is the required list, and no delimiter has to be kept alive in
 * prose for a test to find.
 *
 * ## The table has to stay on exactly one page
 *
 * `credentialByProvider()` builds the mapping from one file. A second copy of those
 * rows anywhere `docs/setup.md` could grow one would make the negative assertion
 * below read a credential as required when it is an alternative, so the rows move
 * as a unit or not at all.
 *
 * ## What the length floor protects, and what it does not
 *
 * `preflightSection()` keeps a floor of 500 characters, and the floor catches one
 * thing: the page emptied or gone, with every assertion after it passing over an
 * empty string. It was proposed that the floor be raised to roughly the page's own
 * size, so that a checklist thinned into a bare link list would fail. It is not:
 * the page is ~2,500 characters of actions and links, a floor set just under that
 * fails the next honest edit, and it would report the failure as "docs/setup.md is
 * empty or missing", which would be false.
 *
 * The discipline that actually broke is the opposite one. `docs/setup.md` has no
 * artifact of its own, so explanation drifts onto it, and four times it had: two
 * paragraphs of `environment.setup_commands`, the `workflow_dispatch` YAML, the
 * `gh release download` block and a restatement of the provider rule all stood
 * here as second copies of pages in the tree. `the checklist copies nothing from
 * the tree` below is the machine-readable half of that: every fenced block on this
 * page has to be an action nowhere else under `docs/` performs. It cannot catch a
 * paragraph restated in different words -- that is what review is for -- but each
 * of the three code blocks it would have caught was carried for years.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const AGENT_DIR = "src/content/agent-definitions";
const SETUP = "docs/setup.md";

/** Every Markdown page under a directory, with the separators links are written in. */
function markdownUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) found.push(...markdownUnder(path));
    else if (entry.endsWith(".md")) found.push(path);
  }
  return found;
}

/** `provider:` from an agent definition's frontmatter. */
function providerOf(file: string): string | undefined {
  const lines = readFileSync(join(AGENT_DIR, file), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = /^provider:\s*(\S+)\s*$/.exec(line);
    if (match?.[1]) return match[1];
    if (line === "---" && lines.indexOf(line) > 0) break; // end of frontmatter
  }
  return undefined;
}

/**
 * The provider -> credential mapping, read out of the configuration reference's table.
 *
 * Rows look like: `| \`openrouter-responses\` | Responses | \`OPENROUTER_API_KEY\` | ... |`
 */
function credentialByProvider(): Map<string, string> {
  const docs = readFileSync("docs/agents/reference.md", "utf8");
  const map = new Map<string, string>();
  for (const line of docs.split(/\r?\n/)) {
    const match = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|[^|]*\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line);
    if (match?.[1] && match[2]) map.set(match[1], match[2]);
  }
  return map;
}

/** The setup guide, which is what a first run depends on being right. */
function preflightSection(): string {
  const setup = readFileSync(SETUP, "utf8").replace(/\r\n/g, "\n");
  expect(setup.length, `${SETUP} is empty or missing`).toBeGreaterThan(500);
  return setup;
}

const agentFiles = readdirSync(AGENT_DIR).filter((file) => file.endsWith(".md"));

describe("the preflight checklist", () => {
  test("the provider table was found and is not empty", () => {
    // Both readers below are regexes over prose. If either quietly matches
    // nothing, every assertion after it passes without checking anything.
    expect(credentialByProvider().size).toBeGreaterThan(4);
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  test("every shipped agent's provider appears in the configuration reference", () => {
    const table = credentialByProvider();
    for (const file of agentFiles) {
      const provider = providerOf(file);
      expect(provider, `${file} declares no provider`).toBeDefined();
      expect(
        table.has(provider!),
        `${file} uses provider '${provider}', which the reference's table does not list. ` +
          `Listed: ${[...table.keys()].sort().join(", ")}`,
      ).toBe(true);
    }
  });

  test("the setup guide names the credential the shipped configuration needs", () => {
    const table = credentialByProvider();
    const preflight = preflightSection();
    for (const file of agentFiles) {
      const credential = table.get(providerOf(file)!);
      expect(
        preflight.includes(credential!),
        `${file} runs on ${providerOf(file)}, which authenticates with ${credential} — ` +
          `and the preflight checklist does not name it. A first run cannot start.`,
      ).toBe(true);
    }
  });

  /**
   * The inverse, and the direction the drift actually went: the checklist named
   * `OPENAI_API_KEY` long after nothing shipped used it. A credential named as
   * required, that nothing reads, sends an adopter to create a secret that does
   * not help and then to debug a failure the checklist caused.
   */
  test("the setup guide requires no credential the shipped configuration does not use", () => {
    const needed = new Set(agentFiles.map((file) => credentialByProvider().get(providerOf(file)!)));
    // The whole page: it carries actions only, so everything on it is required. The
    // alternatives live in `docs/agents/reference.md`, where naming them is the point.
    const required = preflightSection();
    for (const credential of [...credentialByProvider().values()]) {
      if (needed.has(credential)) continue;
      expect(
        required.includes(credential),
        `the checklist requires ${credential}, which no shipped agent definition uses`,
      ).toBe(false);
    }
  });

  /**
   * The checklist copies nothing from the tree.
   *
   * A page with no artifact of its own attracts explanation, and this one had
   * collected three code blocks that a page in the tree already owned -- the
   * `workflow_dispatch` trigger, `gh release download`, and the issue body that
   * starts a run. A copy is not wrong on the day it is made; it is wrong on the day
   * one of the two moves, and nothing says which one the reader is looking at.
   *
   * Fenced blocks rather than prose, because a block is the unit that copies
   * verbatim and the unit a checklist is tempted to carry "so the reader does not
   * have to click".
   */
  test("the checklist copies nothing from the tree", () => {
    const setup = readFileSync(SETUP, "utf8").replace(/\r\n/g, "\n");
    const blocks = [...setup.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) =>
      (m[1] ?? "").replace(/^[ \t]+/gm, "").trim(),
    );
    expect(blocks.length, `${SETUP} has no fenced blocks to compare`).toBeGreaterThan(0);

    const duplicated: string[] = [];
    for (const page of markdownUnder("docs").filter((file) => file !== SETUP)) {
      const other = readFileSync(page, "utf8").replace(/\r\n/g, "\n");
      const normalised = other.replace(/^[ \t]+/gm, "");
      for (const block of blocks) if (normalised.includes(block)) duplicated.push(`${page}: ${block.split("\n")[0]}…`);
    }

    expect(
      duplicated,
      `${SETUP} carries a code block another page already owns:\n  ${duplicated.join("\n  ")}\n` +
        `Link to that page instead — a second copy is what goes stale.`,
    ).toEqual([]);
  });
});

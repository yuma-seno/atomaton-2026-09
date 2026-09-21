import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toolDefaults, whatEachIsFor } from "./shipped-servers.ts";

/**
 * The servers left the config an adopter reads, so the pages that list them are now
 * the only place a person can find out what exists. That makes those pages part of
 * the change rather than documentation of it, and this holds them to it.
 *
 * Both pages, because they answer different questions from different places.
 * `.github/atomaton/README.md` ships INTO an adopted repository and is what somebody
 * opens when they are standing in the directory; `docs/tools/reference.md` is the
 * reference they reach from the config's own header comment. A server missing from
 * either is a server that is invisible from one of the two doors.
 *
 * Those two doors are the one duplication the rest of this tree's "one fact, one
 * place" rule does not remove by linking: a page in the adopter's own tree and a
 * page on GitHub are not the same door, and a link from one to the other is a
 * network round trip for somebody standing in the directory.
 */
const PAGES = ["src/content/README.md", "docs/tools/reference.md"];

describe("the servers Atomaton ships", () => {
  test("every one has a line saying what it is for", () => {
    for (const name of Object.keys(toolDefaults().servers)) {
      const what = whatEachIsFor()[name];
      expect(what, `${name} needs a description; it is the only thing a reader gets`).toBeTruthy();
      // Not the argv. The config used to "show" these as
      // `bun run ${ATOMATON_MACHINERY_ROOT}/...`, which is how they are started rather
      // than what they are for, and replacing one unreadable thing with another
      // would be the whole point missed.
      expect(what, `${name}'s description should not be its command line`).not.toContain("ATOMATON_MACHINERY_ROOT");
    }
  });

  test("nothing is described that is not shipped", () => {
    for (const name of Object.keys(whatEachIsFor())) {
      expect(toolDefaults().servers[name], `${name} is described but not shipped`).toBeDefined();
    }
  });

  test.each(PAGES)("%s names every one of them", (page) => {
    const text = readFileSync(page, "utf8");
    for (const name of Object.keys(toolDefaults().servers)) {
      expect(
        text.includes(`\`${name}\``),
        `${page} does not name \`${name}\`. It is not in config.yaml any more, so a ` +
          "page is the only way anybody finds out it exists.",
      ).toBe(true);
    }
  });

  /**
   * The hooks are in the same position as the servers and for the same reason: they
   * moved out of the config, they cannot be removed, and something has to say so.
   */
  test("the file-wide hooks are described where the servers are", () => {
    expect(Object.keys(toolDefaults().watch).length, "there is at least one").toBeGreaterThan(0);
    const readme = readFileSync("src/content/README.md", "utf8");
    expect(readme, "the README says hooks of your own are added rather than replacing").toContain("tools.watch");
  });

  /**
   * A server with no `command` and no `url` is one the core refuses to load, which it
   * would do at the start of every run rather than at build time. Cheap to check here
   * and expensive to find there.
   */
  test("each one says how to reach it", () => {
    for (const [name, server] of Object.entries(toolDefaults().servers)) {
      const reachable = typeof server.command === "string" || typeof server.url === "string";
      expect(reachable, `${name} names neither a command nor a url`).toBe(true);
    }
  });
});

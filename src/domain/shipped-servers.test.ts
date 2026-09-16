import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHIPPED_SERVERS, SHIPPED_WATCH, WHAT_EACH_IS_FOR } from "./shipped-servers.ts";

/**
 * The servers left the config an adopter reads, so the pages that list them are now
 * the only place a person can find out what exists. That makes those pages part of
 * the change rather than documentation of it, and this holds them to it.
 *
 * Both pages, because they answer different questions from different places.
 * `.github/atoma/README.md` ships INTO an adopted repository and is what somebody
 * opens when they are standing in the directory; `docs/configuration.md` is the
 * reference they reach from the config's own header comment. A server missing from
 * either is a server that is invisible from one of the two doors.
 */
const PAGES = ["src/atoma/README.md", "docs/configuration.md"];

describe("the servers Atoma ships", () => {
  test("every one has a line saying what it is for", () => {
    for (const name of Object.keys(SHIPPED_SERVERS)) {
      const what = WHAT_EACH_IS_FOR[name];
      expect(what, `${name} needs a description; it is the only thing a reader gets`).toBeTruthy();
      // Not the argv. The config used to "show" these as
      // `bun run ${ATOMA_MACHINERY_ROOT}/...`, which is how they are started rather
      // than what they are for, and replacing one unreadable thing with another
      // would be the whole point missed.
      expect(what, `${name}'s description should not be its command line`).not.toContain("ATOMA_MACHINERY_ROOT");
    }
  });

  test("nothing is described that is not shipped", () => {
    for (const name of Object.keys(WHAT_EACH_IS_FOR)) {
      expect(SHIPPED_SERVERS[name], `${name} is described but not shipped`).toBeDefined();
    }
  });

  test.each(PAGES)("%s names every one of them", (page) => {
    const text = readFileSync(page, "utf8");
    for (const name of Object.keys(SHIPPED_SERVERS)) {
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
    expect(Object.keys(SHIPPED_WATCH).length, "there is at least one").toBeGreaterThan(0);
    const readme = readFileSync("src/atoma/README.md", "utf8");
    expect(readme, "the README says hooks of your own are added rather than replacing").toContain("tools.watch");
  });

  /**
   * A server with no `command` and no `url` is one the core refuses to load, which it
   * would do at the start of every run rather than at build time. Cheap to check here
   * and expensive to find there.
   */
  test("each one says how to reach it", () => {
    for (const [name, server] of Object.entries(SHIPPED_SERVERS)) {
      const reachable = typeof server.command === "string" || typeof server.url === "string";
      expect(reachable, `${name} names neither a command nor a url`).toBe(true);
    }
  });
});

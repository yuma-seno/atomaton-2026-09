/**
 * config-paths.test.ts — the dotted paths the machinery says out loud, held to the
 * schema that judges them.
 *
 * ## The failure
 *
 * `resolve_runner.ts` warned an operator that `checks.runs_on` was empty. There has
 * never been a `checks.runs_on`: the key moved under an Atomaton arm in the config
 * redesign, and the warning was built as `${field}.runs_on` at the point of use, where
 * nothing could notice the reader had moved. An adopter who acted on that warning wrote
 * a key `validate_deliverable.ts` rejects — so the message telling them to fix their
 * configuration is what failed their pull request.
 *
 * That is the same defect the documentation had in two places, and it is worse here:
 * prose is read by someone who may doubt it, and a warning emitted by the machinery
 * carries the machinery's authority.
 *
 * ## Why this file rather than a test beside each reader
 *
 * `config-contract.test.ts` holds the DOCUMENTATION to the schema. This holds the
 * RUNTIME MESSAGES to it. They are the two places a key name escapes the code and
 * reaches a person who will type it back, and neither is checked by the type system:
 * both are strings.
 *
 * A path that is about to be named in a message belongs here. The cost of adding one
 * is a line; the cost of not adding one is measured in rejected pull requests.
 */
import { describe, expect, test } from "bun:test";
import { knownConfigKeys } from "../../src/domain/deliverable-integrity.ts";
import { runsOnPath } from "../../src/lib/config.ts";

/**
 * The keys a person can actually set: the schema's leaves, minus the levels where any
 * name is legal. Same definition `config-contract.test.ts` uses for the documentation.
 */
function settableKeys(): string[] {
  const all = knownConfigKeys();
  return all.filter((key) => !all.some((other) => other.startsWith(`${key}.`))).filter((key) => !key.endsWith("*"));
}

describe("paths the machinery names in its own messages", () => {
  /**
   * Every entry is a path some script prints where an adopter can read it. Add one
   * here when you add one there — the list is short because the machinery says very
   * few key names out loud, and it should stay that way.
   */
  const NAMED_IN_MESSAGES: Array<{ what: string; path: string }> = [
    { what: "resolve_runner's runs_on warning (checks)", path: runsOnPath("checks") },
    { what: "resolve_runner's runs_on warning (deploy)", path: runsOnPath("deploy") },
  ];

  test("each one is a key the validator accepts", () => {
    const settable = new Set(settableKeys());
    for (const { what, path } of NAMED_IN_MESSAGES) {
      expect(
        settable.has(path),
        `${what} names \`${path}\`, which the validator rejects. An adopter who acts on ` +
          `that message writes a key that fails their pull request.`,
      ).toBe(true);
    }
  });

  // The list going empty would make the test above pass while checking nothing, and
  // an empty list is indistinguishable from a list whose entries were all removed.
  test("the list is not empty", () => {
    expect(NAMED_IN_MESSAGES.length).toBeGreaterThan(0);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { skillsUnder } from "./write_metrics_report.ts";

/**
 * `skillsUnder` is the list the report subtracts the loaded skills from, so when it
 * comes back empty the report has nothing to call unused. It came back empty on every
 * run for as long as it asked git: the machinery is a release zip unpacked into
 * `${RUNNER_TEMP}/atomaton-machinery`, which is not a git repository, and `git
 * ls-files` over a path outside a repository lists nothing and says nothing.
 *
 * These are the two answers that must stay distinguishable -- a list, and not knowing
 * -- because the empty list in between is the one that reads as good news.
 */
describe("skillsUnder", () => {
  function tree(files: readonly string[]): string {
    const root = mkdtempSync(`${tmpdir()}/skills-`);
    for (const file of files) {
      const at = file.lastIndexOf("/");
      if (at > 0) mkdirSync(`${root}/${file.slice(0, at)}`, { recursive: true });
      writeFileSync(`${root}/${file}`, "# skill");
    }
    return root;
  }

  test("names a nested skill the way a run loads it", () => {
    const root = tree(["delivery/pipeline-setup.md", "engineering/tdd.md"]);
    expect(skillsUnder(root)).toEqual(["delivery/pipeline-setup", "engineering/tdd"]);
  });

  test("a directory that is not there is not an empty catalogue", () => {
    expect(skillsUnder(`${tmpdir()}/atomaton-no-such-skills-dir`)).toBeUndefined();
  });

  /**
   * The case that hid `delivery/pipeline-setup` at zero loads: a readable directory
   * holding nothing this recognises answers the same as an unreadable one. A deployed
   * tree always ships skills, so either way this looked in the wrong place.
   */
  test("a directory with no skill in it is not an empty catalogue either", () => {
    expect(skillsUnder(tree(["README.txt"]))).toBeUndefined();
    expect(skillsUnder(tree([]))).toBeUndefined();
  });

  test("ignores what is not a skill", () => {
    const root = tree(["engineering/tdd.md", "engineering/notes.txt"]);
    expect(skillsUnder(root)).toEqual(["engineering/tdd"]);
  });
});

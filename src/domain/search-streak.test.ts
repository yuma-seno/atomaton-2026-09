import { describe, expect, test } from "bun:test";
import {
  classifyShellAct,
  MAX_SEARCHES_WITHOUT_OPENING,
  nextStreak,
  refusalReason,
  toolOpens,
} from "./search-streak.ts";

describe("what a shell command is doing", () => {
  test("the searches", () => {
    for (const command of [
      "grep -rn 'foo' src/",
      "rg --type ts handler",
      "find . -name '*.wac.ts'",
      "egrep -l pattern src",
      "/usr/bin/grep x file",
    ]) {
      expect(classifyShellAct(command), command).toBe("search");
    }
  });

  test("the opens", () => {
    for (const command of [
      "cat src/foo.ts",
      "head -50 src/foo.ts",
      "tail -n 100 log.txt",
      "sed -n '10,40p' src/foo.ts",
    ]) {
      expect(classifyShellAct(command), command).toBe("open");
    }
  });

  test("everything else is neither", () => {
    for (const command of ["bun test", "ls src", "git status", "cargo build", ""]) {
      expect(classifyShellAct(command), command).toBe("other");
    }
  });

  /**
   * The distinction that matters for the classification: `head` after a pipe paginates
   * a search, it does not open a file. Reading the first command of the pipeline is
   * what tells them apart.
   */
  test("pagination after a search is still a search", () => {
    expect(classifyShellAct("grep -rn foo src/ | head -20")).toBe("search");
    expect(classifyShellAct("rg pattern | wc -l")).toBe("search");
  });

  test("a prefix is stepped over, not read as the command", () => {
    expect(classifyShellAct("GREP_COLORS=never grep -rn foo src/")).toBe("search");
    expect(classifyShellAct("time rg pattern")).toBe("search");
  });
});

describe("the streak", () => {
  test("searching climbs it and opening clears it", () => {
    let streak = 0;
    for (const act of ["search", "search", "search"] as const) streak = nextStreak(streak, act);
    expect(streak).toBe(3);
    expect(nextStreak(streak, "open")).toBe(0);
  });

  /**
   * Running the tests between searches is work, but it is not using what the searches
   * found. An agent that searches ten times, runs the tests, then searches ten more
   * has still opened nothing.
   */
  test("other work neither climbs it nor clears it", () => {
    expect(nextStreak(7, "other")).toBe(7);
  });
});

describe("the refusal", () => {
  test("nothing is refused below the limit", () => {
    expect(refusalReason(MAX_SEARCHES_WITHOUT_OPENING - 1)).toBeUndefined();
    expect(refusalReason(0)).toBeUndefined();
  });

  /**
   * The measured p95 is 3 and the p99 is 8, so an ordinary run never comes near this.
   * The three sessions that did reached 30, 44 and 85.
   */
  test("an ordinary run is never refused", () => {
    for (const streak of [0, 1, 3, 8]) {
      expect(refusalReason(streak), `p95 is 3, p99 is 8; ${streak} is ordinary`).toBeUndefined();
    }
  });

  test("at the limit it says what a search is for and what to do instead", () => {
    const reason = refusalReason(MAX_SEARCHES_WITHOUT_OPENING);
    expect(reason).toBeDefined();
    expect(reason).toContain("where something is, not what it is");
    expect(reason).toContain("open the most promising result");
  });

  /**
   * A refusal has to leave somewhere to go. Fifteen searches with nothing opened is
   * usually an agent guessing at what a thing is called, and guessing is exactly what
   * `search_code` answers — measured, 70% in the top five against 41.5% for the patterns
   * from the same question.
   */
  test("it points at the tool for the case that caused it", () => {
    const reason = refusalReason(MAX_SEARCHES_WITHOUT_OPENING);
    expect(reason).toContain("search__search_code");
    expect(reason).toContain("in a sentence");
  });

  test("the count in the message is the real one", () => {
    expect(refusalReason(85)).toContain("85 searches");
  });
});

/**
 * The rule that was missing, and the one the refusal depends on being true.
 *
 * `shell_guard` sees shell commands. A read through the filesystem server is not one,
 * so until `toolOpens` existed the streak climbed straight through it -- while the
 * refusal was telling the agent to read a file that way. See `search-streak.ts` for
 * the run that cost.
 */
describe("a read that did not go through the shell", () => {
  test("the filesystem server's reads count as opening", () => {
    for (const tool of [
      "filesystem__read_text_file",
      "filesystem__read_multiple_files",
      "filesystem__read_media_file",
      "filesystem_readonly__read_file",
      "filesystem_readonly__read_multiple_files",
    ]) {
      expect(toolOpens(tool), tool).toBe(true);
    }
  });

  /**
   * Listing answers where things are, which is what a search answers. Clearing the
   * streak on one would let a run enumerate for ever without reading anything, which
   * is the shape the whole rule exists to catch.
   */
  test("listing is not opening", () => {
    for (const tool of [
      "filesystem__list_directory",
      "filesystem__directory_tree",
      "filesystem__search_files",
      "filesystem_readonly__get_file_info",
      "shell__shell_execute",
      "github__create_pr",
    ]) {
      expect(toolOpens(tool), tool).toBe(false);
    }
  });

  /** Not anchored to one server: a read is a read whoever performed it. */
  test("the server prefix is not what decides it", () => {
    expect(toolOpens("somethingelse__read_text_file")).toBe(true);
    expect(toolOpens("read_text_file")).toBe(true);
  });

  /**
   * The failure in full. An agent that obeys the refusal must be able to satisfy it;
   * before this, obeying and ignoring ended the same way -- three identical refusals
   * and a dead run.
   */
  test("obeying the refusal clears the streak", () => {
    let streak = MAX_SEARCHES_WITHOUT_OPENING;
    expect(refusalReason(streak)).toBeDefined();

    // What the refusal names, verbatim.
    expect(refusalReason(streak)).toContain("filesystem__read_text_file");
    expect(toolOpens("filesystem__read_text_file")).toBe(true);

    streak = 0; // what the after-hook writes on that read
    expect(refusalReason(nextStreak(streak, "search"))).toBeUndefined();
  });
});

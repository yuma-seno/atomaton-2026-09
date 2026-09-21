/**
 * effective-tools.test.ts — the comparison, and the two shapes of defect it exists
 * for.
 *
 * The cases below are not invented: each is a state `files_readonly` was actually in,
 * or one line away from. A widened set is the allowlist having stopped applying; an
 * emptied set is a server that came up and registered nothing, which an
 * extras-only check would have called a pass.
 */
import { describe, expect, test } from "bun:test";
import {
  compareToolSet,
  describeMismatch,
  EXACT_TOOL_SETS,
  serverContributed,
  type ExactToolSet,
} from "./effective-tools.ts";

const READONLY = EXACT_TOOL_SETS.find((set) => set.server === "files_readonly") as ExactToolSet;
const ENV = EXACT_TOOL_SETS.find((set) => set.server === "atomaton_env") as ExactToolSet;

/** Everything `mcp/files.ts` offers, which is what an unapplied allowlist leaves. */
const EVERY_FILE_TOOL = ["read", "grep", "glob", "edit", "write", "list"];

describe("the table itself", () => {
  test("names the two servers whose purpose is what they withhold", () => {
    expect(EXACT_TOOL_SETS.map((set) => set.server)).toEqual(["files_readonly", "atomaton_env"]);
  });

  // The `files` server is deliberately absent: its six tools are its feature, and an
  // entry for it here would fail the day a seventh is added for a good reason.
  test("says nothing about the writable file server", () => {
    expect(EXACT_TOOL_SETS.some((set) => set.server === "files")).toBe(false);
  });

  test("files_readonly is the file tools minus the three that write", () => {
    expect([...READONLY.tools].sort()).toEqual(["glob", "grep", "list", "read"]);
    for (const writes of ["edit", "write"]) {
      expect(READONLY.tools).not.toContain(writes);
    }
  });
});

describe("compareToolSet", () => {
  test("the shipped set passes", () => {
    expect(compareToolSet(READONLY, ["read", "grep", "glob", "list"])).toBeUndefined();
    expect(compareToolSet(ENV, ["atomaton_env__reload_environment"])).toBeUndefined();
  });

  test("order is not part of the promise", () => {
    expect(compareToolSet(READONLY, ["list", "glob", "grep", "read"])).toBeUndefined();
  });

  // The tools the core adds itself arrive with the binary, not with the
  // configuration. Listing them would make an atoma upgrade fail a check about
  // this repository.
  test("the core's own tools are not the server's", () => {
    expect(compareToolSet(READONLY, ["atoma_builtin__load_skill", "read", "grep", "glob", "list"])).toBeUndefined();
    expect(serverContributed(["atoma_builtin__load_skill", "read"])).toEqual(["read"]);
  });

  /**
   * Case 1: the allowlist stopped being applied at all.
   *
   * This is the state atoma was measured in — every hook an `unprefixed` server
   * declared skipped, no pattern dead, nothing reported. The whole set arrives and
   * only a comparison against the set says so.
   */
  test("an allowlist that stopped applying is caught, with both writers named", () => {
    const mismatch = compareToolSet(READONLY, EVERY_FILE_TOOL);
    expect(mismatch?.unexpected).toEqual(["edit", "write"]);
    expect(mismatch?.missing).toEqual([]);
    expect(describeMismatch(READONLY, mismatch!)).toContain("advertises edit, write, which it must not");
  });

  /** One of them is enough; a read-only server that can `write` is the defect. */
  test("a single writer is a failure", () => {
    expect(compareToolSet(READONLY, ["read", "grep", "glob", "list", "write"])?.unexpected).toEqual(["write"]);
  });

  /**
   * Case 2: an entry was deleted from the allowlist.
   *
   * `unmatched_patterns` returns nothing about a pattern that is not there, so this
   * produces no finding anywhere else. Here it is a `missing` tool.
   */
  test("a deleted allowlist entry is caught", () => {
    const mismatch = compareToolSet(READONLY, ["grep", "glob", "list"]);
    expect(mismatch?.missing).toEqual(["read"]);
    expect(describeMismatch(READONLY, mismatch!)).toContain("does not advertise read, which it must");
  });

  /**
   * A server that came up and registered nothing.
   *
   * This is why the comparison is a set rather than a subset: an expectation that
   * only refused extras is satisfied by an empty answer, and an empty answer is the
   * loudest thing a check can be handed.
   */
  test("advertising nothing fails rather than passes vacuously", () => {
    const mismatch = compareToolSet(READONLY, []);
    expect(mismatch?.missing).toEqual(["read", "grep", "glob", "list"]);
  });

  test("a prefixed server's withheld tools are caught the same way", () => {
    const mismatch = compareToolSet(ENV, [
      "atomaton_env__reload_environment",
      "atomaton_env__launch_sub_agent",
      "atomaton_env__request_close_issue",
    ]);
    expect(mismatch?.unexpected).toEqual(["atomaton_env__launch_sub_agent", "atomaton_env__request_close_issue"]);
  });

  test("the message says what the set is for, not only what is wrong", () => {
    const mismatch = compareToolSet(READONLY, EVERY_FILE_TOOL)!;
    const said = describeMismatch(READONLY, mismatch);
    expect(said).toContain("Expected exactly {read, grep, glob, list}");
    expect(said).toContain("tool_allowlist");
  });
});

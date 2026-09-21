import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubOutput, scriptPath } from "./testing/harness.ts";

describe("decide_turn_ending.ts", () => {
  function run(args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-turn-ending-"));
    const outputFile = join(dir, "out");
    writeFileSync(outputFile, "");
    try {
      const r = spawnSync("bun", ["run", scriptPath("decide_turn_ending.ts"), ...args], {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
      });
      return { status: r.status, out: parseGithubOutput(readFileSync(outputFile, "utf8")) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("releases on a failed run outcome", () => {
    const { status, out } = run(["--outcome", "failure"]);
    expect(status).toBe(0);
    expect(out.should_release).toBe("true");
  });

  test("stays held when a directive hands off to another agent", () => {
    const { out } = run(["--outcome", "success", "--directive", "reviewer"]);
    expect(out.should_release).toBe("false");
  });

  test("stays held when the chain already continues via a tool-triggered dispatch", () => {
    const { out } = run(["--outcome", "success", "--chain-continues", "true"]);
    expect(out.should_release).toBe("false");
  });

  test("releases when the run reached its limit even mid-chain", () => {
    const { out } = run(["--outcome", "success", "--ended-because", "runtime", "--chain-continues", "true"]);
    expect(out.should_release).toBe("true");
  });

  // A stopped run handed back to the person who stopped it. Holding the guard would
  // leave them unable to comment on the issue they just took control of.
  test("releases when a person stopped the run, even mid-chain", () => {
    const { out } = run(["--outcome", "success", "--ended-because", "stopped", "--chain-continues", "true"]);
    expect(out.should_release).toBe("true");
  });

  test("releases when nothing further is happening", () => {
    const { out } = run(["--outcome", "success", "--reported", "true"]);
    expect(out.should_release).toBe("true");
  });

  /**
   * The ending `finished` used to swallow. Published by name so the run is not filed
   * as a success, and the guard still comes off -- nothing is working on that node.
   */
  test("a run that ended having said nothing is published as such, and still releases", () => {
    const { out } = run(["--outcome", "success", "--reported", "false"]);
    expect(out.ended).toBe("no-report");
    expect(out.should_release).toBe("true");
    expect(out.dispatch_to).toBe("");
  });

  test("and a run that did leave a report is finished", () => {
    expect(run(["--outcome", "success", "--reported", "true"]).out.ended).toBe("finished");
  });

  /**
   * Absent is not "reported". The argument is threaded from a step output, and a
   * caller that drops it should get the answer that fetches a person rather than the
   * one that records a success nobody checked.
   */
  test("no --reported at all is read as nothing said", () => {
    expect(run(["--outcome", "success"]).out.ended).toBe("no-report");
  });

  test("fails open (releases) when --outcome is missing entirely, instead of leaving the guard stuck", () => {
    const { status, out } = run([]);
    expect(status).toBe(0);
    expect(out.should_release).toBe("true");
  });

  /**
   * The outputs the two dispatch steps read.
   *
   * They used to read a four-term Actions expression built from the same signals
   * this step already had — so the same decision existed twice, and only one copy
   * could be tested. These assert the published half; `domain/work/turn.ts` holds
   * the rule.
   */
  describe("who runs next", () => {
    test("a hand-off publishes who to start, and nothing to explain away", () => {
      const { out } = run(["--outcome", "success", "--directive", "reviewer"]);
      expect(out.ended).toBe("handed-off");
      expect(out.dispatch_to).toBe("reviewer");
      expect(out.chain_over_to).toBe("");
    });

    test("the chain's limit publishes who would have run, and starts nobody", () => {
      const { out } = run(["--outcome", "success", "--directive", "reviewer", "--loop-limit-reached", "true"]);
      expect(out.ended).toBe("chain-over");
      expect(out.dispatch_to).toBe("");
      expect(out.chain_over_to).toBe("reviewer");
    });

    /** A directive from a run that crashed is not a hand-off. */
    test("a failed run starts nobody, whatever it named", () => {
      const { out } = run(["--outcome", "failure", "--directive", "reviewer"]);
      expect(out.ended).toBe("failed");
      expect(out.dispatch_to).toBe("");
      expect(out.chain_over_to).toBe("");
    });

    test("a tool call having already dispatched starts nobody a second time", () => {
      const { out } = run(["--outcome", "success", "--chain-continues", "true"]);
      expect(out.ended).toBe("handed-off");
      expect(out.dispatch_to).toBe("");
    });
  });
});

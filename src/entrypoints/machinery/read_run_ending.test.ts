import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endingFromSession } from "./read_run_ending.ts";
import { parseGithubOutput, scriptPath } from "./testing/harness.ts";

/** A session as the core leaves it, with the run records it appends. */
const sessionWith = (...endings: string[]) =>
  JSON.stringify({
    messages: [],
    atoma_runs: endings.map((ended_because, i) => ({
      started: `2026-01-0${i + 1}T00:00:00Z`,
      ended: `2026-01-0${i + 1}T00:10:00Z`,
      seconds: 600,
      ended_because,
      messages: 4,
      iterations: 2,
    })),
  });

describe("endingFromSession", () => {
  /** The LAST record: earlier ones are previous runs on the same session. */
  test("reads the ending the run that just finished recorded", () => {
    expect(endingFromSession(sessionWith("completed", "stopped", "runtime"))).toBe("runtime");
  });

  test("a session with no records has nothing to say", () => {
    expect(endingFromSession(JSON.stringify({ messages: [] }))).toBeUndefined();
    expect(endingFromSession(JSON.stringify({ atoma_runs: [] }))).toBeUndefined();
  });

  /** Anything unreadable is "no record", not a failure: the caller has a fallback. */
  test("nothing readable is nothing said", () => {
    expect(endingFromSession("not json")).toBeUndefined();
    expect(endingFromSession(JSON.stringify({ atoma_runs: "surely not" }))).toBeUndefined();
    expect(endingFromSession(JSON.stringify({ atoma_runs: [{ ended_because: "" }] }))).toBeUndefined();
    expect(endingFromSession(JSON.stringify({ atoma_runs: [{ seconds: 1 }] }))).toBeUndefined();
  });
});

describe("read_run_ending.ts", () => {
  function run(files: { session?: string; stopFile?: boolean }, exitCode: string) {
    const dir = mkdtempSync(join(tmpdir(), "atomaton-run-ending-"));
    const outputFile = join(dir, "out");
    const sessionPath = join(dir, "session.json");
    const stopFile = join(dir, "stop-requested");
    writeFileSync(outputFile, "");
    if (files.session !== undefined) writeFileSync(sessionPath, files.session);
    if (files.stopFile) writeFileSync(stopFile, "");
    try {
      const r = spawnSync(
        "bun",
        ["run", scriptPath("read_run_ending.ts"), "--session", sessionPath, "--exit-code", exitCode, "--stop-file", stopFile],
        { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: outputFile } },
      );
      return { status: r.status, out: parseGithubOutput(readFileSync(outputFile, "utf8")) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("takes the core's word for it", () => {
    expect(run({ session: sessionWith("stopped") }, "2").out.ended_because).toBe("stopped");
    expect(run({ session: sessionWith("runtime") }, "2").out.ended_because).toBe("runtime");
    expect(run({ session: sessionWith("completed") }, "0").out.ended_because).toBe("completed");
  });

  /**
   * The distinction the guess could not make. `iterations` and `runtime` are two
   * different ceilings and the result comment says a different sentence for each;
   * both used to arrive as one boolean.
   */
  test("tells the two ceilings apart", () => {
    expect(run({ session: sessionWith("iterations") }, "2").out.ended_because).toBe("iterations");
    expect(run({ session: sessionWith("runtime") }, "2").out.ended_because).toBe("runtime");
  });

  /**
   * And the race it could not avoid. The stop file is written by a watcher while
   * the run is going, so a run that reached its time limit at the moment somebody
   * typed `/stop` exits for the clock with the file already there.
   */
  test("a stop file present does not override what the run recorded", () => {
    const { out } = run({ session: sessionWith("runtime"), stopFile: true }, "2");
    expect(out.ended_because).toBe("runtime");
  });

  describe("when the run wrote no session", () => {
    test("the stop file is the fallback, and only then", () => {
      expect(run({ stopFile: true }, "2").out.ended_because).toBe("stopped");
      expect(run({}, "2").out.ended_because).toBe("runtime");
    });

    test("a clean exit is still a completed run", () => {
      expect(run({}, "0").out.ended_because).toBe("completed");
    });

    /** Never exits non-zero: an ending nobody published leaves a step's condition empty. */
    test("it reports rather than failing", () => {
      expect(run({}, "2").status).toBe(0);
      expect(run({ session: "not json" }, "2").status).toBe(0);
    });
  });
});

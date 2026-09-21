import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endingFromSession, parseSession } from "./read_run_ending.ts";
import { parseGithubOutput, scriptPath } from "./testing/harness.ts";

/** What the script does with the bytes it read, so these exercise the real path. */
const endingOfText = (raw: string) => endingFromSession(parseSession(raw));

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
    expect(endingOfText(sessionWith("completed", "stopped", "runtime"))).toBe("runtime");
  });

  test("a session with no records has nothing to say", () => {
    expect(endingOfText(JSON.stringify({ messages: [] }))).toBeUndefined();
    expect(endingOfText(JSON.stringify({ atoma_runs: [] }))).toBeUndefined();
    expect(endingFromSession(undefined)).toBeUndefined();
  });

  /** Anything unreadable is "no record", not a failure: the caller has a fallback. */
  test("nothing readable is nothing said", () => {
    expect(parseSession("not json")).toBeUndefined();
    expect(endingOfText("not json")).toBeUndefined();
    expect(endingOfText(JSON.stringify({ atoma_runs: "surely not" }))).toBeUndefined();
    expect(endingOfText(JSON.stringify({ atoma_runs: [{ ended_because: "" }] }))).toBeUndefined();
    expect(endingOfText(JSON.stringify({ atoma_runs: [{ seconds: 1 }] }))).toBeUndefined();
  });
});

// `reportedInSession` used to be here beside `endingFromSession`. Both facts are still
// read out of one session in one place, but the reading itself moved to
// `domain/record/closing-report.ts` once the metrics report needed the same answer --
// its tests went with it. The script's own output is asserted below.

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
   * Two facts about one run, out of one file. `turn.ts` has no word for a run that
   * ran to an ordinary end and said nothing unless somebody observes the silence, and
   * this is where it is observed.
   */
  test("publishes whether the run left a report, beside how it ended", () => {
    const said = JSON.stringify({
      messages: [{ role: "assistant", content: "Done: the parser now rejects an empty tag." }],
      atoma_runs: [{ started: "", ended: "", seconds: 1, ended_because: "completed", messages: 2 }],
    });
    const silent = JSON.stringify({
      messages: [{ role: "assistant", content: "", tool_calls: [{ function: { name: "shell__shell_execute" } }] }],
      atoma_runs: [{ started: "", ended: "", seconds: 1, ended_because: "completed", messages: 2 }],
    });
    expect(run({ session: said }, "0").out.reported).toBe("true");
    expect(run({ session: silent }, "0").out.reported).toBe("false");
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

    /** No session is no evidence of a report, and the direction that speaks up wins. */
    test("it reports nothing rather than assuming a report", () => {
      expect(run({}, "0").out.reported).toBe("false");
      expect(run({ session: "not json" }, "0").out.reported).toBe("false");
    });

    /** Never exits non-zero: an ending nobody published leaves a step's condition empty. */
    test("it reports rather than failing", () => {
      expect(run({}, "2").status).toBe(0);
      expect(run({ session: "not json" }, "2").status).toBe(0);
    });
  });
});

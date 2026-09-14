import { describe, expect, test } from "bun:test";
import { metricsOf, type SessionRecord } from "/home/runner/work/atoma-autonomous-delivery/atoma-autonomous-delivery/src/domain/metrics.ts";
import { renderReport } from "/home/runner/work/atoma-autonomous-delivery/atoma-autonomous-delivery/src/domain/metrics-report.ts";

const session = (path: string, agent: string, messages: number, runs: Record<string, unknown>[] = [], calls: Record<string, unknown>[] = []): SessionRecord =>
  ({ path, agent, messages, runs, calls }) as SessionRecord;

describe("plural probe", () => {
  test("renders with every count at one and reports any '1 ...s' prose", () => {
    const runs = [
      { started: "2026-09-13T00:00:00Z", ended: "2026-09-13T00:01:00Z", seconds: 60, ended_because: "completed", messages: 10 },
    ];
    const one = metricsOf(
      [session("sessions/issue-1/engineer.json", "engineer", 10, runs, [
        { tool: "shell__shell_execute", agent: "engineer", failed: false, refused: false, act: "search" },
      ])],
      ["shell"],
      ["engineering/tdd"],
      [{ issue: 1, total: 1000, prompt: 980, completion: 20 }],
    );
    const report = renderReport(one, () => one, new Date("2026-09-14T00:00:00Z"));
    const matches = report.split("\n").filter((line) => /\b1 \w+s\b/.test(line));
    console.log("LINES MATCHING '1 <plural>':", JSON.stringify(matches, null, 2));
    console.log("--- full report ---");
    console.log(report);
  });
});

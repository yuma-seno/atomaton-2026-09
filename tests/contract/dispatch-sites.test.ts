/**
 * dispatch-sites.test.ts — nothing may start a workflow run behind
 * `lib/dispatch-targets.ts`'s back.
 *
 * ## The failure this exists for
 *
 * One fact — **GitHub starts no workflow run for an event its own token triggered**
 * — is bridged by dispatching explicitly. `lib/dispatch-targets.ts` was written to
 * hold those bridges and to say why they exist. Its header said "All four" while the
 * module held five, and three more had been written elsewhere:
 *
 * - `scripts/dispatch_new_tags.ts` named `atomaton-deploy.yml` outright, so it did
 *   not know `deploy.your_workflow` existed;
 * - the runner's "Dispatch next agent" step and the validation workflow's
 *   "Dispatch the agent the result calls for" step each wrote their own
 *   `gh workflow run atomaton-runner.yml` in bash — bypassing `lib/dispatch.ts`,
 *   whose header says, of the closed-target guard it holds: *"a guard that each of
 *   them has to remember is one the fifth will not have. See #827."* Those two were
 *   the fifth and the sixth. Neither refused a closed target and neither wrote the
 *   ops-log dispatch entry.
 *
 * Every one of those was a correct-looking line of code. What made them wrong was
 * only visible from the whole set, and nothing could see the whole set — which is
 * what this test is: the place a seventh has to pass through.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Written this way for the reason `generated-workflows.test.ts` does: a literal newline in a source file here is a CRLF. */
const NEWLINE = String.fromCharCode(10);

/**
 * The one module allowed to build the command.
 *
 * `lib/gh.ts` exports `dispatchWorkflow`, which every bridge calls. That is the
 * boundary this test draws: not "who may dispatch" — several legitimately do — but
 * "who may write the call", so a new one is a call to a named function rather than
 * an argv nobody else can see.
 */
const MAY_BUILD_THE_CALL = "src/lib/gh.ts";

/** Every `.ts` under `src/`, excluding tests. */
function sourceFiles(): string[] {
  return readdirSync("src", { recursive: true })
    .map(String)
    .map((name) => join("src", name).replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
}

describe("the places that start a workflow run", () => {
  /**
   * `gh("workflow", "run", ...)`, wherever it is spelled. A script that builds its
   * own is one that has its own idea of which workflow, which inputs, and what a
   * failure means — which is how the tag bridge came to ignore
   * `deploy.your_workflow`, and how two workflow steps came to skip the
   * closed-target guard.
   */
  test("only lib/gh.ts builds a `gh workflow run` command", () => {
    const offenders = sourceFiles()
      .filter((path) => path !== MAY_BUILD_THE_CALL)
      .filter((path) => /"workflow"\s*,\s*"run"/.test(readFileSync(path, "utf8")));

    expect(
      offenders,
      `these build their own dispatch instead of calling dispatchWorkflow: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * And the same for a workflow's own shell, which is where two of them hid. A step
   * that needs to start an agent calls `scripts/dispatch_agent.ts`; a step that needs
   * to start anything else has no business doing it from bash, where none of the
   * guards can reach.
   */
  test("no generated workflow starts a run from its own bash", () => {
    const dir = "dist/.github/workflows";
    // The step bodies, not the file: a `#` line saying why a run has no `--ref`
    // mentions the command without being one, and a test that cannot tell them apart
    // is one whose next fix is to stop explaining things in comments.
    const dispatchesFromBash = (yaml: string): boolean => {
      type Document = { jobs?: Record<string, { steps?: { run?: string }[] }> };
      const document = Bun.YAML.parse(yaml) as Document;
      return Object.values(document.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .map((step) => step.run ?? "")
        .map((body) => body.split(NEWLINE).filter((line) => !line.trimStart().startsWith("#")).join(NEWLINE))
        .some((body) => /gh\s+workflow\s+run/.test(body));
    };

    const withRawDispatch = readdirSync(dir)
      .filter((name) => name.endsWith(".yml"))
      .filter((name) => dispatchesFromBash(readFileSync(join(dir, name), "utf8")));

    expect(
      withRawDispatch,
      `these dispatch from bash, so nothing guards them: ${withRawDispatch.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The count that went stale. Every bridge the module exports has to appear in the
   * header that explains why bridges exist — so adding one without saying which
   * event it stands in for is a failing test rather than a comment that is quietly
   * wrong.
   */
  test("every bridge is named in the header that explains them", () => {
    const source = readFileSync("src/lib/dispatch-targets.ts", "utf8");
    const header = source.slice(0, source.indexOf("*/"));
    const exported = [...source.matchAll(/export function (dispatch\w+)/g)].map((m) => m[1]);

    expect(exported.length, "this module is where the bridges live").toBeGreaterThan(1);
    const unexplained = exported.filter((name) => !header.includes(`\`${name}\``));
    expect(
      unexplained,
      `add these to the table in dispatch-targets.ts's header, with the event each replaces: ${unexplained.join(", ")}`,
    ).toEqual([]);
    // The one that lives next door, because an agent hand-off carries a guard the
    // others do not. The header names it so a reader looking for "how does an agent
    // get started" is not left to find `dispatch.ts` by accident.
    expect(header).toContain("`dispatchRunner`");
  });
});

import { describe, expect, test } from "bun:test";
import { distributionOf, metricsOf, type CallRecord, type SessionRecord } from "./metrics.ts";
import { renderReport } from "./metrics-report.ts";
import { sessionEndedAt, within, type Window } from "./metrics-windows.ts";
/**
 * Render with the same metrics in every window.
 *
 * The report asks for one metrics per window; a test about what a table says does not
 * care which window it lands in, and a test about windows says so explicitly.
 */
function render(metrics: ReturnType<typeof metricsOf>, now: Date): string {
  return renderReport(metrics, () => metrics, now);
}


const call = (tool: string, extra: Partial<CallRecord> = {}): CallRecord => ({
  tool,
  agent: "engineer",
  failed: false,
  refused: false,
  ...extra,
});

const SESSIONS: SessionRecord[] = [
  {
    path: "sessions/issue-1/engineer.json",
    agent: "engineer",
    messages: 10,
    runs: [],
    calls: [
      call("shell__shell_execute", { act: "search" }),
      call("shell__shell_execute", { act: "open" }),
      call("filesystem__read_text_file"),
      call("atoma_builtin__load_skill", { skill: "engineering/tdd" }),
      call("github__create_pr", { failed: true }),
      call("shell__shell_execute", { act: "edit", refused: true }),
    ],
  },
  { path: "sessions/issue-2/reviewer.json", agent: "reviewer", messages: 40, runs: [], calls: [call("github__get_pr")] },
];

const SERVERS = ["shell", "filesystem", "github", "web", "search"];
const SKILLS = ["engineering/tdd", "delivery/pipeline-setup"];
const TOKENS = [
  { issue: 1, total: 1000, prompt: 980, completion: 20, cached: 490 },
  { issue: 2, total: 3000, prompt: 2900, completion: 100 },
];

describe("distributionOf", () => {
  /** Nearest rank, not interpolated: each of these is a thing that happened. */
  test("percentiles are values that occur", () => {
    const d = distributionOf([1, 2, 3, 4, 100]);
    expect([d.p50, d.max, d.total]).toEqual([3, 100, 110]);
  });

  test("nothing measured is not an error", () => {
    expect(distributionOf([])).toEqual({ p50: 0, p90: 0, p99: 0, max: 0, total: 0 });
  });
});

describe("metricsOf", () => {
  const metrics = metricsOf(SESSIONS, SERVERS, SKILLS, TOKENS);

  /**
   * The defect the first run against real data exposed. `tools.yaml` declares servers
   * (`filesystem`) and a call names a tool (`filesystem__read_text_file`), so comparing
   * the two directly reported every server as unused -- a section of confident nonsense.
   */
  test("an unused server is one whose tools nothing called", () => {
    expect(metrics.neverUsedServers).toEqual(["search", "web"]);
  });

  test("an unloaded skill is named, since it is described in every prompt", () => {
    expect(metrics.neverLoaded).toEqual(["delivery/pipeline-setup"]);
  });

  /**
   * The two answers this could not tell apart, and the one that lied.
   *
   * The skill list is built by listing a directory. While that directory was being
   * renamed the listing came back empty, an empty list filtered to an empty list, and
   * the report said every skill had been loaded -- with `delivery/pipeline-setup`,
   * 1387 words, sitting at zero loads out of 187 behind that sentence.
   *
   * `[]` is an answer: nothing is declared, so nothing is unused. `undefined` is not an
   * answer, and has to read as one.
   */
  test("a list that could not be read is not a list that is empty", () => {
    const unknown = metricsOf(SESSIONS, undefined, undefined, TOKENS);
    expect(unknown.neverUsedServers).toBeUndefined();
    expect(unknown.neverLoaded).toBeUndefined();

    const none = metricsOf(SESSIONS, [], [], TOKENS);
    expect(none.neverUsedServers).toEqual([]);
    expect(none.neverLoaded).toEqual([]);
  });

  test("failures and refusals are counted apart", () => {
    expect(metrics.byTool.find((t) => t.name === "github__create_pr")?.failed).toBe(1);
    expect(metrics.refusals).toBe(1);
  });

  test("shell acts are tallied, which is where the guard arguments live", () => {
    expect(metrics.byAct.map((a) => a.name).sort()).toEqual(["edit", "open", "search"]);
  });

  /** 97-99% measured, every time. It is why prompt is where savings come from. */
  test("the prompt share is reported", () => {
    expect(Math.round((metrics.tokens?.promptShare ?? 0) * 1000) / 10).toBe(97);
  });

  test("no run reporting tokens means no token section rather than zeroes", () => {
    expect(metricsOf(SESSIONS, SERVERS, SKILLS, []).tokens).toBeUndefined();
  });

  /**
   * Over the runs that reported it, and over their prompt -- not over everything.
   * Here that is 490 of one run's 980, which is 50%; counting the other run's 2,900
   * unreported prompt into the denominator would print 13% and call the cache broken.
   */
  test("the cache share is over the runs that reported one", () => {
    const cached = metricsOf(SESSIONS, SERVERS, SKILLS, TOKENS).tokens?.cached;
    expect(cached).toEqual({ runs: 1, tokens: 490, ofPrompt: 0.5 });
  });

  /**
   * The distinction the field exists for. A window where no provider reported a
   * cache must not come back as a cache that served nothing: one is a gap in the
   * measurement, the other is a fault worth acting on, and they read alike as 0%.
   */
  test("no run reporting a cache is unknown rather than a cache that missed", () => {
    const none = [{ issue: 1, total: 1000, prompt: 980, completion: 20 }];
    expect(metricsOf(SESSIONS, SERVERS, SKILLS, none).tokens?.cached).toBeUndefined();
  });
});

describe("renderReport", () => {
  const NOW = new Date("2026-09-13T00:00:00Z");

  test(`the report says it could not check, rather than that nothing is unused`, () => {
    const text = render(metricsOf(SESSIONS, undefined, undefined, TOKENS), NOW);
    expect(text).toContain("could not be read");
    expect(text).not.toContain("Every skill has been loaded at least once.");
    expect(text).not.toContain("Every declared server has been called at least once.");
  });
  const report = render(metricsOf(SESSIONS, SERVERS, SKILLS, TOKENS), NOW);

  /**
   * Each table counts a different thing, and the first version labelled all of them
   * "calls" -- so the agent table read as though `reviewer` had made 236 calls when it
   * had run 236 times.
   */
  test("every table says what it is counting", () => {
    expect(report).toContain("| agent | sessions | share |");
    expect(report).toContain("| skill | loads | share |");
    expect(report).toContain("| act | calls | share |");
  });

  /**
   * A run from before atoma v0.1.39 recorded no round trips, and it must not be read as
   * a run that waited on nothing.
   *
   * Averaging a zero in is the exact failure this repository keeps finding in a new
   * place: an absent measurement borrowing the shape of a real one. Here it would say
   * the median run makes half the round trips it makes, and nothing would look wrong.
   */
  test("a run that recorded no round trips is left out rather than counted as zero", () => {
    const at = "2026-09-12T00:00:00Z";
    const withCount = { started: at, ended: at, seconds: 100, ended_because: "completed", messages: 20, iterations: 10 };
    const without = { started: at, ended: at, seconds: 100, ended_because: "completed", messages: 20 };
    const sessions: SessionRecord[] = [
      { path: "sessions/issue-9/engineer.json", agent: "engineer", messages: 20, calls: [], runs: [withCount, without] },
    ];

    const text = render(metricsOf(sessions, [], [], []), NOW);
    // 10 round trips over 100 seconds, from the one run that said so. With the other
    // averaged in as zero, neither number survives.
    expect(text).toContain("| 10 | 10.0 |");
  });

  test("no run recorded any round trips, so the columns say so rather than zero", () => {
    const at = "2026-09-12T00:00:00Z";
    const sessions: SessionRecord[] = [
      {
        path: "sessions/issue-8/engineer.json",
        agent: "engineer",
        messages: 20,
        calls: [],
        runs: [{ started: at, ended: at, seconds: 100, ended_because: "completed", messages: 20 }],
      },
    ];
    expect(render(metricsOf(sessions, [], [], []), NOW)).toContain("| — | — |");
  });

  /**
   * Named, not counted: the point is that somebody can go and delete them. The heading
   * they sit under has moved once already, so the assertion is on the names.
   */
  test("it names the servers and skills nothing used", () => {
    expect(report).toContain("- `web`");
    expect(report).toContain("- `delivery/pipeline-setup`");
    expect(report).toContain("never");
  });

  /** No money, deliberately: see the module comment. */
  test("it reports tokens and never a cost", () => {
    expect(report).toContain("4,000 tokens");
    expect(report).not.toMatch(/[$€£]\d/);
  });

  /**
   * The share, and how many runs it covers. Printing 50% without saying it came from
   * one of two runs invites reading it as the fleet's cache rate, which it is not.
   */
  test("the cache share says how many runs it is over", () => {
    expect(report).toContain("50% of that prompt was served from cache");
    expect(report).toContain("1 of 2 runs");
  });

  /**
   * A window where nothing reported it has to say so. Omitting the sentence reads as
   * "nothing to report about the cache", which is the same silence as a cache that is
   * working and as one that has been switched off.
   */
  test("a window where nothing reported a cache says so rather than nothing", () => {
    const none = [{ issue: 1, total: 1000, prompt: 980, completion: 20 }];
    const text = render(metricsOf(SESSIONS, SERVERS, SKILLS, none), NOW);
    expect(text).toContain("unknown rather than zero");
    expect(text).not.toContain("served from cache");
  });

  /**
   * The window line is read by a person, and "1 sessions" / "over 1 runs" reads as a
   * bug. One test, both counts: the singular shape and the plural shape it must not
   * disturb.
   */
  test("a count of one is singular", () => {
    const one = render(
      metricsOf(
        [{ path: "sessions/issue-1/engineer.json", agent: "engineer", messages: 10, runs: [], calls: [] }],
        [],
        [],
        [{ issue: 1, total: 1000, prompt: 980, completion: 20 }],
      ),
      NOW,
    );
    expect(one).toContain("1 session.");
    expect(one).toContain("over 1 run that reported them");

    expect(report).toContain("2 sessions.");
    expect(report).toContain("over 2 runs that reported them");
  });

  /**
   * The date is passed in rather than read from the clock, so a rerun that changed
   * nothing produces no commit.
   */
  test("the same input renders the same output", () => {
    expect(render(metricsOf(SESSIONS, SERVERS, SKILLS, TOKENS), NOW)).toBe(report);
  });
});

/**
 * The section that answers "is this getting better or worse", which is the question
 * dogfooding exists to ask and the only one an all-time table cannot answer.
 */
describe("the run windows", () => {
  const NOW = new Date("2026-09-13T12:00:00Z");
  const run = (ended: string, why = "completed", seconds = 60) => ({
    started: ended,
    ended,
    seconds,
    ended_because: why,
    messages: 20,
  });
  const withRuns = (runs: ReturnType<typeof run>[]) => [
    { path: "a", agent: "engineer", messages: 10, runs, calls: [] },
  ];

  /**
   * The state this repository is in until atoma v0.1.28 has run. An omitted section
   * would read as "nothing went wrong"; this says what is actually true.
   */
  test("no recorded run says so rather than showing empty tables", () => {
    const report = render(metricsOf(withRuns([]), [], [], []), NOW);
    expect(report).toContain("No run has recorded itself yet");
    expect(report).not.toContain("| window |");
  });

  test("a run counts in every window that reaches it", () => {
    const report = render(
      metricsOf(withRuns([run("2026-09-13T00:00:00Z"), run("2026-08-01T00:00:00Z", "failed")]), [], [], []),
      NOW,
    );
    expect(report).toContain("| Last 7 days | 1 |");
    expect(report).toContain("| All time | 2 |");
  });

  /** An empty window is a row, not a gap, so the reader can see it was asked. */
  test("a window with nothing in it is still a row", () => {
    expect(render(metricsOf(withRuns([run("2026-01-01T00:00:00Z")]), [], [], []), NOW)).toContain(
      "| Last 7 days | 0 | — | — | — |",
    );
  });

  test("every ending that is not completed counts as giving up", () => {
    const report = render(
      metricsOf(
        withRuns([run("2026-09-13T00:00:00Z"), run("2026-09-13T00:00:00Z", "iterations")]),
        [],
        [],
        [],
      ),
      NOW,
    );
    expect(report).toContain("| Last 7 days | 2 | 50% |");
    expect(report).toContain("| `iterations` | 1 |");
  });
});

/**
 * The two defects a reader found in the first report, both of which made it say
 * something false with confidence.
 */
describe("what a window is for, beyond trend", () => {
  const NOW = new Date("2026-09-14T00:00:00Z");
  const call = (tool: string, extra: Partial<CallRecord> = {}): CallRecord => ({
    tool,
    agent: "engineer",
    failed: false,
    refused: false,
    ...extra,
  });
  const sessions: SessionRecord[] = [
    {
      path: "old",
      agent: "engineer",
      messages: 300,
      runs: [],
      calls: [call("shell__terminal_operate", { failed: true }), call("filesystem__search_files", { refused: true })],
    },
    {
      path: "new",
      agent: "engineer",
      messages: 10,
      runs: [
        { started: "2026-09-13T00:00:00Z", ended: "2026-09-13T00:01:00Z", seconds: 60, ended_because: "completed", messages: 10 },
      ],
      calls: [call("search__search_issues")],
    },
  ];
  const forWindow = (window: Window) =>
    metricsOf(sessions.filter((s) => within(sessionEndedAt(s.runs), window, NOW)), [], [], []);
  const report = renderReport(metricsOf(sessions, [], [], []), forWindow, NOW);
  const section = (label: string) => {
    const start = report.indexOf(`## ${label}`);
    const next = report.indexOf("\n## ", start + 1);
    return report.slice(start, next === -1 ? undefined : next);
  };

  /**
   * `shell__terminal_operate` was 333 failures from a server this repository stopped
   * running, sitting in the same table as tools it still uses. Nothing detects a retired
   * tool — time removes it, which also leaves a hallucinated tool name visible.
   */
  test("a tool nothing has called lately falls out of the recent windows", () => {
    expect(section("Last 7 days")).not.toContain("terminal_operate");
    expect(section("All time")).toContain("terminal_operate");
  });

  /**
   * A denylist refusing 43 of 44 calls was rendered as "97.7% failure rate", which reads
   * as a broken tool rather than as a guard doing its job.
   */
  test("a guard refusing a call is not counted as the tool failing", () => {
    const row = metricsOf(sessions, [], [], []).byTool.find((t) => t.name === "filesystem__search_files");
    expect([row?.failed, row?.refused]).toEqual([0, 1]);
    expect(section("All time")).toContain("| `filesystem__search_files` | 1 | 0 | 1 | 0% |");
  });
});

/**
 * The third state. `failed` is an error instead of an answer, `refused` is a guard
 * saying no, and this is an answer that arrived worse than it should have. Two real
 * defects lived in this data unread -- an audit log writing to a path that did not
 * exist, and a search falling back to unranked results -- because nothing counted it.
 */
describe("degraded answers", () => {
  const withProblem = (tool: string, server: string, problem: string, extra: Partial<CallRecord> = {}) =>
    call(tool, { problems: [{ server, problem }], ...extra });

  const session = (path: string, calls: CallRecord[], at?: string) => ({
    path,
    agent: "engineer",
    messages: 10,
    runs: [],
    calls,
    at,
  });

  test("a problem reported beside a successful answer is counted", () => {
    const m = metricsOf(
      [session("a", [withProblem("search__search_code", "search", "reranking failed")], "2026-09-13T00:00:00Z")],
      [],
      [],
      [],
    );
    expect(m.degraded).toHaveLength(1);
    expect(m.degraded[0]).toMatchObject({ server: "search", count: 1, sessions: 1 });
  });

  /**
   * Otherwise this section becomes a second copy of the failure and refusal columns,
   * and the one state it exists to show is buried in the two that were already visible.
   */
  test("a call that failed or was refused is not counted again here", () => {
    const m = metricsOf(
      [
        session("a", [
          withProblem("github__get_pr", "github", "x", { failed: true }),
          withProblem("github__close_issue", "github", "y", { refused: true }),
        ]),
      ],
      [],
      [],
      [],
    );
    expect(m.degraded).toEqual([]);
  });

  /**
   * The reranker's complaints arrive on whatever call was in flight when the search
   * server noticed, so taking the name from the tool filed them under `atoma_builtin` --
   * a server with no reranker in it.
   */
  test("the server is the one that reported, not the one that was called", () => {
    const m = metricsOf(
      [session("a", [withProblem("atoma_builtin__load_skill", "search", "could not preload the reranker")])],
      [],
      [],
      [],
    );
    expect(m.degraded[0]?.server).toBe("search");
  });

  /**
   * One run reporting the same fault ten times is one fault. Counting sessions as well
   * as reports is what keeps a chatty run from looking like a widespread problem.
   */
  test("reports and sessions are counted separately", () => {
    const m = metricsOf(
      [
        session("a", [
          withProblem("search__search_code", "search", "same"),
          withProblem("search__search_code", "search", "same"),
        ]),
        session("b", [withProblem("search__search_code", "search", "same")]),
      ],
      [],
      [],
      [],
    );
    expect(m.degraded).toHaveLength(1);
    expect(m.degraded[0]).toMatchObject({ count: 3, sessions: 2 });
  });

  /**
   * Recency over volume, because the question is whether it is still happening. A fault
   * seen once today matters more than one seen forty times in August, which is the shape
   * of a fault somebody already fixed.
   */
  test("the most recently seen problem is listed first", () => {
    const m = metricsOf(
      [
        session("old", Array.from({ length: 40 }, () => withProblem("search__search_code", "search", "loud but old")), "2026-08-01T00:00:00Z"),
        session("new", [withProblem("github__get_pr", "github", "quiet but current")], "2026-09-14T00:00:00Z"),
      ],
      [],
      [],
      [],
    );
    expect(m.degraded[0]?.problem).toBe("quiet but current");
  });
});

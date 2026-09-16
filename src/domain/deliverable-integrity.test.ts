/**
 * deliverable-integrity.test.ts — the rules that decide whether a `.github/atomaton/`
 * can start a run.
 *
 * Every case here is a name that resolves to nothing, or a setting that would be
 * read as absent. That is the shape of the whole class: none of it fails loudly on
 * its own, which is why it needed a check.
 */
import { describe, expect, test } from "bun:test";
import { configProblems, knownConfigKeys } from "./deliverable-integrity.ts";
import { DEFAULT_CD_WORKFLOW, DEFAULT_CI_WORKFLOW } from "./shipped-workflows.ts";

/**
 * The shipped configuration, near enough: consistent, and the baseline for each case.
 *
 * Grouped the way `config.yaml` groups it — by who consumes the value — so a case
 * that replaces one section replaces everything that section decides, and nothing
 * else.
 */
const SOUND = {
  base_branch: "",
  environment: { setup_commands: [] },
  checks: { atoma_runs: { commands: [], secrets: [] } },
  deploy: { atoma_runs: { targets: [], secrets: [] } },
  merge: { policy: "auto" },
  chain: { labels: { in_progress: "atoma/in-progress" } },
  tools: { secrets: [] },
};

const facts = (config: unknown) => ({
  config,
  agentNames: ["engineer", "orchestrator", "reviewer"],
  workflowFiles: [DEFAULT_CI_WORKFLOW, DEFAULT_CD_WORKFLOW, "atoma-runner.yml"],
});

const problemsFor = (config: unknown) => configProblems(facts(config));

describe("a sound deliverable", () => {
  test("reports nothing", () => {
    expect(problemsFor(SOUND)).toEqual([]);
  });

  // The shipped file sets almost nothing. Absent is not the same as invalid, and a
  // check that could not tell them apart would fail every fresh adoption.
  test("an almost-empty config is sound", () => {
    expect(problemsFor({})).toEqual([]);
  });
});

describe("keys nothing reads", () => {
  test("a misspelled top-level key is reported", () => {
    const problems = problemsFor({ ...SOUND, enviroment: { setup_commands: ["bun install"] } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`enviroment`");
  });

  // The nested form is exactly as silent and rather more likely: the reader asks
  // for `checks.atoma_runs.commands`, finds nothing, and runs no commands.
  test("a misspelled nested key is reported with its path", () => {
    const problems = problemsFor({ ...SOUND, checks: { atoma_runs: { command: ["bun test"] } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`checks.atoma_runs.command`");
  });

  // `chain.labels` has an index signature: a project may name labels of its own, and
  // those are not typos.
  test("a project's own label name is legal", () => {
    expect(problemsFor({ ...SOUND, chain: { labels: { in_progress: "wip", needs_design: "design" } } })).toEqual([]);
  });

  /**
   * The one level the schema deliberately stops naming keys at.
   *
   * `tools.servers.<name>` is handed to the core verbatim — this is where
   * `tools/tools.yaml` went — so what may be inside one is the core's vocabulary
   * and not this project's: `url` and `headers` for a remote server, and whatever a
   * later release adds. Reporting those as typos is the opposite failure to the one
   * this module exists for, and the only one of the two an adopter cannot work
   * around: a setting the core accepts, held out of the repository by a check.
   */
  test("a key inside a server entry is the core's to recognise, not this module's", () => {
    const problems = problemsFor({
      ...SOUND,
      tools: {
        secrets: [],
        servers: {
          search: {
            url: "https://example.invalid/mcp",
            headers: { Authorization: "Bearer x" },
            settings: { reranker_model: "onnx-community/bge-reranker-v2-m3-ONNX" },
          },
        },
      },
    });
    expect(problems).toEqual([]);
  });

  test("a config that is not a mapping is reported once", () => {
    expect(problemsFor([])).toHaveLength(1);
    expect(problemsFor("x")).toHaveLength(1);
  });
});

/**
 * `atoma_runs` and `your_workflow` are alternatives, and the structure says so by
 * putting them side by side. The check says it again in a sentence, because "both
 * are set" is otherwise a precedence puzzle: one of the two is being ignored, and
 * nothing anywhere says which.
 */
describe("two arms, and exactly one of them", () => {
  test("declaring both is reported, in either section", () => {
    for (const section of ["checks", "deploy"] as const) {
      const problems = problemsFor({ ...SOUND, [section]: { atoma_runs: {}, your_workflow: DEFAULT_CI_WORKFLOW } });
      expect(problems, section).toHaveLength(1);
      expect(problems[0], section).toContain(`\`${section}\``);
    }
  });

  test("either arm on its own is sound", () => {
    expect(problemsFor({ ...SOUND, checks: { your_workflow: DEFAULT_CI_WORKFLOW } })).toEqual([]);
    expect(problemsFor({ ...SOUND, deploy: { your_workflow: DEFAULT_CD_WORKFLOW } })).toEqual([]);
  });
});

/**
 * The resolvers this module runs are the ones that already run — just later. Each
 * case here is a configuration that resolves to "nothing configured" today, at
 * merge, deploy or credential-handout time, with nothing said at pull-request time.
 */
describe("the resolvers, run early", () => {

  test("a malformed merge gate is reported", () => {
    expect(
      problemsFor({ ...SOUND, merge: { gates: [{ reason: "r", when: { title_match: "^x" } }] } }).length,
    ).toBeGreaterThan(0);
  });

  test("a malformed deploy target is reported", () => {
    expect(problemsFor({ ...SOUND, deploy: { atoma_runs: { targets: [{ name: "Prod" }] } } }).length).toBeGreaterThan(
      0,
    );
  });

  // A declared credential that collides with one the run needs for itself would
  // replace it. Today that fails the run; here it fails the pull request.
  //
  // Three destinations, and the declaration sits at a different depth in each:
  // `tools.secrets` is the agent's own, the other two live inside the arm that
  // declares the commands they are handed to.
  test("a reserved credential name is reported for every destination", () => {
    for (const [section, declaration] of [
      ["tools", { secrets: ["GH_TOKEN"] }],
      ["checks", { atoma_runs: { secrets: ["GH_TOKEN"] } }],
      ["deploy", { atoma_runs: { secrets: ["GH_TOKEN"] } }],
    ] as const) {
      const problems = problemsFor({ ...SOUND, [section]: declaration });
      expect(problems.length, section).toBeGreaterThan(0);
    }
  });
});

describe("names that have to resolve to a file", () => {
  /**
   * `auto_triggers` was removed because nothing read it: the one consumer went when
   * opening a pull request stopped starting anyone by itself, and the single shipped
   * entry named a condition this project handles by parsing the comment body.
   *
   * An adopter's config may still carry it, and silence would be the wrong answer --
   * they wrote a setting believing it did something. The unknown-key rule already
   * says so, and this pins that it keeps saying so for this key in particular.
   */
  test("a config still carrying auto_triggers is told nothing reads it", () => {
    const problems = problemsFor({
      ...SOUND,
      auto_triggers: [{ event: "pull_request.opened", agent: "reviewer" }],
    });
    expect(problems.join(" ")).toContain("auto_triggers");
    expect(problems.join(" ")).toContain("not a setting Atoma reads");
  });

  // The key an adopter is most likely to still have: it configured a per-agent
  // iteration budget, and nothing has read it since a run stopped being bounded by
  // turns. Reported as unrecognised, which is what it now is.
  test("a per-agent iteration budget is reported as a key nothing reads", () => {
    const problems = problemsFor({ ...SOUND, agents: { engineer: { max_iterations: 200 } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`agents`");
  });

  // The inverse of every other rule here: not a name that resolves to nothing, but
  // one that resolves to two things. `/stop` is read as a control command before the
  // agent namespace is consulted, so `stop.md` could never be invoked.
  test("an agent named after a control command is reported", () => {
    const problems = configProblems({ ...facts(SOUND), agentNames: ["engineer", "reviewer", "stop"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("agent-definitions/stop.md");
    expect(problems[0]).toContain("/stop");
  });

  // Without definitions there is nothing to resolve against, and reporting every
  // name as missing would bury the one problem that matters.
  test("no agent definitions at all is one problem, not one per name", () => {
    const problems = configProblems({ ...facts(SOUND), agentNames: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("agent-definitions");
  });
});

describe("the workflows a dispatch names", () => {
  test("a configured workflow that is not a file is reported", () => {
    const problems = problemsFor({ ...SOUND, checks: { your_workflow: "ci.yml" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ci.yml");
  });

  test("the shipped defaults are what an unset value resolves to", () => {
    const problems = configProblems({ ...facts(SOUND), workflowFiles: ["atoma-runner.yml"] });
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain(DEFAULT_CI_WORKFLOW);
    expect(problems.join(" ")).toContain(DEFAULT_CD_WORKFLOW);
  });

  // A repository whose workflows were not listed — because this ran somewhere the
  // directory does not exist — must not report both defaults as missing.
  test("an unreadable workflow directory checks nothing", () => {
    expect(configProblems({ ...facts(SOUND), workflowFiles: [] })).toEqual([]);
  });
});

describe("labels", () => {
  test("an empty label is reported", () => {
    for (const value of ["", "   ", 3, null]) {
      const problems = problemsFor({ ...SOUND, chain: { labels: { in_progress: value } } });
      expect(problems, String(value)).toHaveLength(1);
      expect(problems[0], String(value)).toContain("chain.labels.in_progress");
    }
  });
});

describe("knownConfigKeys", () => {
  // The projection `config-contract.test.ts` compares against the interface. Held
  // here too, because a shape change there would otherwise be diagnosed as a
  // mismatch with the type rather than as a change to this function.
  test("renders a wildcard level as `*` and descends through it", () => {
    const keys = knownConfigKeys();
    expect(keys).toContain("chain.labels.*");
    expect(keys).toContain("chain.labels.in_progress");
    expect(keys).toContain("checks.atoma_runs.commands");
    expect(keys).toEqual([...keys].sort());
  });

  // A server entry is two wildcard levels and no names at all: the name of the
  // server is this project's, everything inside it is the core's. An enumeration
  // here would be one program guessing at another's vocabulary, and going stale
  // every time that other program ships a key.
  test("a server entry's interior is a wildcard, not an enumeration", () => {
    const keys = knownConfigKeys();
    expect(keys).toContain("tools.servers.*.*");
    expect(keys.filter((key) => key.startsWith("tools.servers.*.") && key !== "tools.servers.*.*")).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { configProblems, knownConfigKeys } from "../../src/domain/deliverable-integrity.ts";
import { CONDITION_KEYS, resolveMergeGates } from "../../src/domain/merge-gates.ts";
import { SCRIPTS_DIR } from "../../src/domain/machinery-layout.ts";
import type { AtomaConfig } from "../../src/lib/types.ts";

/**
 * The shipped template's config.
 *
 * Read with `Bun.YAML.parse`, which is what `lib/config.ts` reads it with: a file
 * this test accepts has to be a file the readers accept, and a second parser here
 * could disagree with the one that runs. Typed as the interface plus an index
 * signature so a test can also ask about a key the interface does NOT have.
 */
function shippedConfig(): AtomaConfig & Record<string, unknown> {
  return Bun.YAML.parse(readFileSync("src/atomaton/config.yaml", "utf8")) as AtomaConfig & Record<string, unknown>;
}

describe("config.yaml", () => {
  test("is valid and matches expected shape", () => {
    const c = shippedConfig();
    // Asserted absent, not merely unused: a run is bounded by its time now, and the
    // runner reads that from the job it is inside rather than from here. A key that
    // nothing reads and that the schema no longer recognises would be reported to an
    // adopter as a typo the moment they touched their config.
    expect(c.agents).toBeUndefined();
    expect(c.merge?.policy).toBe("manual");
    expect(c.chain?.labels).toBeDefined();
  });

  // Gates are the project's own conditions, so the template ships none. A
  // default `db/migrations/**` would be a guess about somebody else's repository,
  // and a wrong one would block their merges on day one. Present and empty rather
  // than absent, because YAML can carry the comment saying what the key is for.
  test("the shipped template declares no merge gates", () => {
    const c = shippedConfig();
    expect(c.merge?.gates).toEqual([]);
    expect(resolveMergeGates(c.merge?.gates)).toEqual({ gates: [], problems: [] });
  });
});

// The condition set and the table documenting it are joined by nothing but two
// people writing the same words. A condition added in code and left out of the
// docs is unfindable; one documented and never implemented is worse, because
// someone writes it, it is rejected as unknown, and the docs said it existed.
describe("merge.gates documentation", () => {
  // The resolver's own list, not a copy of it. A copy meant adding a condition and
  // forgetting this array left it undocumented while both tests below still passed.
  const CONDITIONS = CONDITION_KEYS;

  test("every condition the code accepts appears in the configuration reference", () => {
    const docs = readFileSync("docs/configuration.md", "utf8");
    for (const condition of CONDITIONS) {
      expect(docs, `${condition} must be documented`).toContain(`\`${condition}\``);
    }
  });

  test("the code accepts every condition the guide documents", () => {
    // Read back through the resolver rather than against a second list: a
    // documented condition that the resolver rejects reports itself here.
    for (const condition of CONDITIONS) {
      const value = condition === "title_matches" ? "^x" : ["db/migrations/**"];
      const { gates, problems } = resolveMergeGates([{ reason: "r", when: { [condition]: value } }]);
      expect(problems, condition).toEqual([]);
      expect(gates, condition).toHaveLength(1);
    }
  });

  test("the reviewer knows what to do with the blockers a gate produces", () => {
    const reviewer = readFileSync("src/atomaton/agent-definitions/reviewer.md", "utf8");
    for (const kind of ["merge-gate", "gate-config-invalid"]) {
      expect(reviewer, `${kind} must be in the reviewer's blocker table`).toContain(`\`${kind}\``);
    }
  });
});

/**
 * config.yaml's recognised keys, in the type and at run time.
 *
 * `AtomaConfig` in `lib/types.ts` is the definition and `CONFIG_SCHEMA` in
 * `domain/deliverable-integrity.ts` is the runtime mirror, because an interface is
 * erased before anything can consult it. Two lists of the same fact — which is
 * exactly what `validate_deliverable.ts` exists to catch in an adopter's config, so
 * it had better not be uncheckable here.
 *
 * The interface is the authority, and this reads it with TypeScript's own parser
 * rather than with a regular expression. A regex was tried and is not good enough:
 * the nested members are indented inconsistently in that file (one is at five
 * spaces), `Record<string, {...}>` has to be understood rather than matched, and an
 * index signature means something specific — any name is legal here — that a line
 * pattern cannot distinguish from a property.
 *
 * Drift in either direction is a real failure. A key added to the type and not to
 * the schema is reported to an adopter as a typo, for a setting the code reads. One
 * added to the schema and not the type is accepted and read by nothing.
 */
describe("config.yaml's recognised keys", () => {
  /** `Record<string, X>`'s value type, or undefined when `type` is not one. */
  function recordValueType(type: ts.TypeNode | undefined, source: ts.SourceFile): ts.TypeNode | undefined {
    if (!type || !ts.isTypeReferenceNode(type)) return undefined;
    if (type.typeName.getText(source) !== "Record") return undefined;
    return type.typeArguments?.[1];
  }

  /** Dotted paths under `path`, with `*` for a level where any name is legal. */
  function descend(type: ts.TypeNode | undefined, path: string, source: ts.SourceFile, out: string[]): void {
    if (!type) return;
    if (ts.isTypeLiteralNode(type)) {
      if (type.members.some((member) => ts.isIndexSignatureDeclaration(member))) out.push(`${path}.*`);
      for (const member of type.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        const child = `${path}.${member.name.getText(source)}`;
        out.push(child);
        descend(member.type, child, source, out);
      }
      return;
    }
    const value = recordValueType(type, source);
    if (value) {
      out.push(`${path}.*`);
      descend(value, `${path}.*`, source, out);
    }
  }

  function keysFromTheInterface(): string[] {
    const file = "src/lib/types.ts";
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === "AtomaConfig",
    );
    expect(declaration, "AtomaConfig is no longer an interface in src/lib/types.ts").toBeDefined();

    const out: string[] = [];
    for (const member of declaration!.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      const name = member.name.getText(source);
      out.push(name);
      descend(member.type, name, source, out);
    }
    return out.sort();
  }

  test("the runtime schema and the interface name the same keys", () => {
    expect(knownConfigKeys()).toEqual(keysFromTheInterface());
  });

  /**
   * The keys a person can actually set: the leaves of the schema, minus the levels
   * where any name is legal.
   *
   * A parent is not settable on its own — writing `checks: {}` configures nothing
   * — and `chain.labels.*` is not a key at all, it is permission to invent one. So
   * neither belongs in a list an adopter reads.
   */
  function settableKeys(): string[] {
    const all = knownConfigKeys();
    return all
      .filter((key) => !all.some((other) => other.startsWith(`${key}.`)))
      .filter((key) => !key.endsWith("*"))
      .sort();
  }

  /**
   * Every backticked token in the configuration reference.
   *
   * The reference is prose, not a list: a key is documented in the section it
   * belongs to, by its full dotted path or by its leaf name under a heading that
   * supplies the rest. So this collects the tokens and the two tests below ask
   * different questions of them, rather than demanding one flat bullet list the
   * page would be worse for carrying.
   */
  function documentedTokens(file: string): Set<string> {
    const docs = readFileSync(file, "utf8");
    return new Set([...docs.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!));
  }

  /**
   * Every page that names configuration keys to somebody who might write them.
   *
   * Only `docs/configuration.md` was held to the schema, and `docs/operations.md`
   * spent that time telling operators the handoff cap was `limits.agent_handoffs`
   * -- a namespace that has never existed. An adopter who followed it had their
   * pull request failed by the validator for following the documentation, which is
   * the exact failure this file exists to prevent. Coverage stopped one file short
   * of the reader.
   */
  const PAGES_THAT_NAME_KEYS = [
    "docs/configuration.md",
    "docs/setup.md",
    "docs/recipes.md",
    "docs/writing-a-tool.md",
    "docs/operations.md",
    "README.md",
    "CONTRIBUTING.md",
  ];

  /**
   * Every settable key is written down somewhere a person can find it.
   *
   * `checks.atomaton_runs.runs_on`, `deploy.atomaton_runs.targets` and the three
   * `chain.labels` entries were each settable and each undocumented when this
   * test was written -- five keys an adopter could only find by reading the
   * validator's schema.
   */
  test("the configuration reference documents every settable key", () => {
    const tokens = documentedTokens("docs/configuration.md");
    const undocumented = settableKeys().filter(
      (key) => !tokens.has(key) && !tokens.has(key.split(".").pop()!),
    );
    expect(undocumented, "these keys are settable and documented nowhere").toEqual([]);
  });

  /**
   * The reverse, and the direction that does real damage: a key documented but not
   * read is one an adopter writes, and `validate_deliverable.ts` then fails their
   * pull request for following the documentation. This page said `checks.secrets`
   * and `deploy.secrets` when both had moved under `atomaton_runs`.
   *
   * Only dotted paths are policed. A bare leaf name in prose -- `policy`, `gates`
   * -- is a word as often as it is a key, and a test that cannot tell the two apart
   * would be answered by removing backticks from the docs.
   */
  test("every config path any page names is one the schema recognises", () => {
    const all = knownConfigKeys();
    const tops = new Set(all.filter((key) => !key.includes(".")));
    const settable = new Set(settableKeys());

    /**
     * Dotted tokens on `file` that start with a top-level config key.
     *
     * Two shapes start with one by coincidence and are not paths: a filename
     * (`tools.yaml` is the generated file, not something under `tools`), and a
     * fragment of YAML quoted inline (`tools.servers.<name>.env: ${NAME}`), which
     * carries a value and so contains a colon or a space. `<name>` is how the docs
     * write a level where any name is legal, and `*` is how the schema writes it.
     */
    function configPathsNamedBy(file: string): string[] {
      return [...documentedTokens(file)]
        .filter((token) => !/[\s:]/.test(token))
        .filter((token) => !/\.(ya?ml|json|md|ts|sh|lock)$/.test(token))
        .map((token) => token.replaceAll("<name>", "*"))
        .filter((token) => token.includes(".") && tops.has(token.split(".")[0]!));
    }

    let namedAnywhere = 0;
    for (const file of PAGES_THAT_NAME_KEYS) {
      const named = configPathsNamedBy(file);
      namedAnywhere += named.length;

      const unrecognised = named.filter((token) => {
        if (all.includes(token)) return false;
        // A path reaching into a settable key's own value -- `merge.gates[].when.labels`
        // is inside the array `merge.gates` holds, and the schema stops at the array.
        // A path reaching past a key with children of its own is a typo for one of them.
        return ![...settable].some((key) => token.startsWith(key) && ".[".includes(token[key.length] ?? ""));
      });
      expect(unrecognised, `${file} names these, and the validator rejects them`).toEqual([]);
    }
    expect(namedAnywhere, "the documentation names config paths at all").toBeGreaterThan(0);

    /**
     * That the filters above did not quietly eat the thing being checked.
     *
     * They did once. `[\s:]` was written into this file with the backslash stripped,
     * leaving `[s:]` -- which discards every token containing the letter `s`, and so
     * most real config paths. The count above stayed positive, because `merge.policy`
     * has no `s` in it, and the check sat inert while reading as green.
     *
     * A count cannot catch that. Naming paths that the broken filter would have
     * dropped, and requiring them to survive, can.
     */
    const examined = new Set(PAGES_THAT_NAME_KEYS.flatMap(configPathsNamedBy));
    for (const path of ["tools.secrets", "checks.pull_request_runs.commands"]) {
      expect(examined.has(path), `${path} is documented, so the filters must not drop it`).toBe(true);
    }
  });

  // The walk above finds nothing if the interface is renamed or the file moves, and
  // an empty list would compare equal to an empty schema.
  test("the walk found something", () => {
    expect(keysFromTheInterface().length).toBeGreaterThan(10);
  });

  // Every key the shipped config sets has to be one the schema recognises, or the
  // template validates as broken on the first adoption.
  test("the shipped config.yaml declares only recognised keys", () => {
    expect(
      configProblems({
        config: shippedConfig(),
        agentNames: readdirSync("src/atomaton/agent-definitions")
          .filter((file) => file.endsWith(".md"))
          .map((file) => file.slice(0, -".md".length)),
        workflowFiles: readdirSync("dist/.github/workflows"),
      }),
    ).toEqual([]);
  });
});

/**
 * The template ships one check, and it has to be one every adopter can run.
 *
 * `checks.pull_request_runs.commands` was empty, which `run_checks.ts` reports as "this check
 * verified nothing" -- true, and the first hour of an adoption is a poor time to learn it.
 * A credential is a credential in every language, so a secret scan is the one verification
 * a template can hand a project it knows nothing about. Everything beside it in that list
 * is the project's own and only the project can write it.
 */
describe("the default checks a project inherits", () => {
  const commands = shippedConfig().checks?.pull_request_runs?.commands ?? [];

  test("there is at least one, so an adoption does not start verifying nothing", () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  /**
   * A default that names a file the deliverable does not carry fails in the adopter's
   * repository and not in ours, which is the worst place to find out. The path is the
   * one every other invocation uses, so it also has to keep working when the machinery
   * is checked out somewhere else.
   */
  /**
   * The path is built from `SCRIPTS_DIR` rather than written out again.
   *
   * It was a literal `.github/scripts/`, and when the scripts moved under
   * `.github/atomaton-runtime/` the shipped default check went on naming a directory
   * that no longer exists -- in the one command every adopter inherits, and in this
   * repository's own pipeline. This test stayed green throughout, because a stale
   * pattern matched a stale path and agreed with it. Its failure message had already
   * been updated to say `atoma-runtime`, which is how close it came to noticing.
   *
   * Two literals of one fact is the shape; importing the constant is the fix.
   */
  test("each one runs a script the deliverable actually ships", () => {
    for (const command of commands) {
      expect(command, `${command} should run a script under ${SCRIPTS_DIR}/`).toContain(`${SCRIPTS_DIR}/`);
      const named = new RegExp(`${SCRIPTS_DIR.replaceAll("/", "\\/")}\\/([A-Za-z0-9_-]+\\.ts)`).exec(command);
      expect(named, `${command} names no script under ${SCRIPTS_DIR}/`).not.toBeNull();
      expect(existsSync(`src/scripts/${named![1]}`), `src/scripts/${named![1]} must exist`).toBe(true);
      expect(command, "the machinery root indirection every other invocation uses").toContain(
        "${ATOMATON_MACHINERY_ROOT:-.}",
      );
    }
  });

  /**
   * The adopter's own commands go beside this one, not instead of it -- so a default
   * that assumed a language would be a default most adopters delete. Nothing here may
   * name a package manager or a runtime beyond the one Atomaton already requires.
   */
  test("no default assumes what the project is written in", () => {
    for (const command of commands) {
      expect(command).not.toMatch(/\b(npm|yarn|pnpm|cargo|pip|poetry|go|mvn|gradle|dotnet)\b/);
    }
  });
});

/**
 * machinery-layout.ts — where each piece of the deployed machinery lives.
 *
 * ## Why these are constants and not settings
 *
 * A path here is not a preference. It is how a reader — a person, an agent, or a
 * later version of this deliverable — recognises what a file is. `agent-definitions/`
 * says what it holds; a `definitions_dir` key pointing anywhere would say only that
 * somebody chose.
 *
 * The question was asked properly and answered no. Every constraint this system
 * relies on is shaped around a ROOT rather than around individual files:
 *
 *   - `setfacl -R` grants the tool user read on `ATOMATON_MACHINERY_ROOT`. A path
 *     outside it is unreadable to the servers, and the symptom is "no server
 *     started" rather than "that path was wrong".
 *   - `merge.governed_paths` defaults to `.github/**`, which is what keeps a change to a
 *     model, a tool list or a role prompt in a person's hands. A redirected
 *     `agent-definitions/` leaves that gate permanently, on one approval that
 *     reads as tidying.
 *   - Both upgrade paths — `cp -r self/. .github/` here, `unzip -o` for an
 *     adopter — replace by POSITION. A redirected tree is never upgraded again,
 *     and the new upstream copy lands beside it unread.
 *
 * And one of these can never be a setting whatever is decided about the rest:
 * the scripts directory holds the programs that open the configuration. A file
 * cannot tell you where to find the thing that reads it.
 *
 * The core is configurable here and this is not, which looks like a contradiction
 * and is not one. `atoma` takes every path as an argument because it has no
 * project of its own — it is handed a layout. This deliverable IS the layout.
 * Core's configurability is the seam through which this repository exercises
 * ownership, and these constants are what it passes through that seam.
 *
 * ## Why they are in one module
 *
 * They were in six, independently re-derived: the workflow generator, the config
 * reader, the secret slots, the bundler, the metrics report and the test harness
 * each spelled `.github/atomaton/...` for themselves. Nothing failed, because they
 * agreed — which is exactly how a set of literals stays wrong once one of them
 * moves.
 *
 * `validate_deliverable.ts` is the deliberate exception and does not import this.
 * It validates a pull request's OWN deployed tree, which is data to it and
 * never code; taking its paths from that tree would let a pull request redirect
 * the validation that is judging it.
 */

/**
 * The directory an adopter edits. Nothing else in `.github/` is theirs.
 *
 * That sentence is the whole layout, and it was not true until this constant split
 * in two. `.github/atomaton/` used to hold the tool servers' implementations and their
 * package list beside the config, the agent definitions and the skills -- so the rule
 * a reader needed was "this folder is yours, except these parts", which is not a rule
 * anybody keeps.
 *
 * What stayed is what a project tunes: the config, the agent definitions, the prompt
 * template, the skills, and the ruleset it applies by hand. Every one of those
 * degrades when it is edited badly -- a worse-informed agent, not a dead run.
 */
export const USER_ROOT = ".github/atomaton";

/**
 * What Atomaton runs, and what a project does not touch.
 *
 * The MCP servers, the hooks, the default tool declarations, and the scripts the
 * workflows invoke. Separate from [`USER_ROOT`] so that "everything outside
 * `.github/atomaton/` is ours" has no exceptions -- `.github/workflows/` is the only
 * other directory, and GitHub decides where that lives.
 *
 * Deleting something here breaks a run rather than degrading one. That is the line:
 * hide what breaks, show what degrades.
 */
export const RUNTIME_ROOT = ".github/atomaton-runtime";

/**
 * The one path that cannot come from configuration, named here rather than left
 * as the literal nobody mentions.
 *
 * `secret-slots.ts` reads it with `git show refs/atomaton/trusted-config:<this>` —
 * out of the default branch's object store, before any file exists on disk.
 * That read is a security boundary: it is what stops a pull request declaring
 * which credentials it may reach.
 */
export const CONFIG_FILE = `${USER_ROOT}/config.yaml`;

/** Agent definitions: one file per agent, frontmatter plus the role prompt. */
export const AGENT_DEFINITIONS_DIR = `${USER_ROOT}/agent-definitions`;

/** The system prompt every agent's role prompt is placed into. */
export const PROMPT_TEMPLATE = `${USER_ROOT}/prompt-template.md`;

/** Skills: instructions loaded on demand, addressed by `<category>/<name>`. */
export const SKILLS_DIR = `${USER_ROOT}/skills`;

/**
 * Where the tool servers' own scripts and hooks live.
 *
 * There is deliberately no `TOOLS_FILE` beside this. The file the core reads is
 * written per run by `scripts/write_tools_file.ts`, from `tools.servers` in the
 * config, into the run's temp directory — so it has no place in this layout at all.
 *
 * It used to be here, and shipped. That gave an adopter a config and a file generated
 * from it, with nothing on their side able to regenerate one from the other: editing
 * `tools.servers` did nothing, and adding a server blocked every run. A path constant
 * for a generated artifact is how a build output starts looking like part of the
 * layout.
 *
 * This directory is still a real path, because the hook scripts are real files and
 * the generated file's hook paths are written against it.
 */
export const TOOLS_DIR = `${RUNTIME_ROOT}/tools`;

/**
 * The servers a run starts with, and the packages they need, as data.
 *
 * Shipped rather than compiled in. It was a TypeScript constant for one release,
 * which meant the only way to see what `github`'s `env` actually held was to grep a
 * bundled script -- and the same definition was inlined into two of them.
 *
 * The same schema as `tools.servers` in the config, so there is one shape to learn
 * and one merge to understand. A project's entry with the same name overrides this
 * one field by field; a name that is not here is added.
 */
export const TOOL_DEFAULTS_FILE = `${TOOLS_DIR}/defaults.yaml`;

/**
 * Hook scripts.
 *
 * Not passed to the core: it resolves a hook path against the tools file's own
 * directory, so this constant exists for the steps that must grant access to the
 * directory rather than for anything that names it to `atoma`.
 */
export const TOOL_HOOKS_DIR = `${TOOLS_DIR}/hooks`;

/**
 * Packages the SHIPPED tool servers need, installed before a run.
 *
 * Here rather than in `.github/atomaton/` because both entries exist for a shipped
 * server -- `@modelcontextprotocol/server-filesystem` is what `filesystem` runs, and
 * `@huggingface/transformers` is what `search` reranks with. Neither is a project's
 * decision, and a project that adds a server of its own declares what it needs in
 * `tools.packages`, beside the server itself.
 *
 * The install step hashes BOTH files for its cache key. Hashing one would let a
 * project add a package, hit a cache keyed on the other, and get a runner without
 * it -- with nothing saying why.
 */
export const TOOL_PACKAGES_FILE = `${TOOLS_DIR}/packages.json`;

/** Branch rulesets, in GitHub's own import format rather than this project's. */
export const RULESETS_DIR = `${USER_ROOT}/rulesets`;

/**
 * The scripts the workflows run.
 *
 * Under [`RUNTIME_ROOT`] with the tool servers, though the two have different
 * callers: these are started by GitHub Actions and those by `atoma`. What they
 * share is the thing the layout is sorted by -- neither is a project's to edit.
 *
 * It was `.github/scripts/`, which made the rule "everything outside
 * `.github/atomaton/` is ours" need a second clause naming a second directory. One
 * root for the runtime is what lets the rule be a sentence.
 */
export const SCRIPTS_DIR = `${RUNTIME_ROOT}/scripts`;

/** What the deployed release is, written by the deploy and read to decide whether an upgrade is due. */
export const RELEASE_MANIFEST = ".github/atomaton-release.json";

/**
 * The variable that says which tree every path above resolves against.
 *
 * Named here because it belongs to this layout: the paths are relative, and this is
 * what they are relative TO. It was typed out as a literal in five places — the
 * config reader, two scripts that resolved it by hand, the shell the workflow
 * generator writes, and the runner's own steps — with each of those carrying its own
 * spelling of what an unset value means.
 *
 * ## What it decides, which is not one answer
 *
 * Which tree is trusted for a given read is a property of the JOB, not of the reader,
 * and the three jobs differ on purpose:
 *
 *   the agent's run    Set, to a checkout of the default branch. A pull-request run's
 *                      workspace is the pull request's own head, so reading how the
 *                      run behaves from there would let a pull request choose which
 *                      agent reviews it, with which commands and which credentials.
 *   checks             Unset: the job's checkout IS what it reads, and for the
 *                      `from_pull_request` arm that is the point — an agent adds a
 *                      dependency and proves it in the same pull request. It grants
 *                      nothing, because no credential reaches that arm.
 *   deployment         Unset: the tag, or the default branch. Both are post-merge.
 *
 * So `machineryPath()` (see `adapters/runner/machinery.ts`) resolves a path and deliberately does
 * NOT decide trust. The one read that must never accept the job's checkout —
 * the credential declaration — refuses to resolve a path at all and is handed one:
 * see `scripts/read_secret_names.ts`.
 */
export const MACHINERY_ROOT_VAR = "ATOMATON_MACHINERY_ROOT";

/**
 * Which directory under `src/` builds each deployed tree.
 *
 * The deployed layout above is a published interface: an adopter's tree is replaced
 * by position, so a path there is one this repository may not move on a whim. The
 * source layout is not — it is ours, and `docs/template/architecture.md` sorts it by layer.
 * The two were the same name for as long as `src/atomaton/` deployed to
 * `.github/atomaton/`, and `build-dist.ts` derived one from the other by slicing the
 * string.
 *
 * They are not the same name any more, so the correspondence is written down. A
 * table rather than a derivation, because there is nothing left to derive: `content/`
 * is what a project receives, `entrypoints/machinery/` is what a workflow step runs,
 * `entrypoints/tools/` is what the core starts, and none of those three words appears
 * in the path it lands at.
 *
 * `tests/contract/deployment-contract.test.ts` holds both ends of it to the trees
 * that exist.
 */
export const BUILT_FROM: ReadonlyArray<readonly [deployed: string, source: string]> = [
  [USER_ROOT, "content"],
  [SCRIPTS_DIR, "entrypoints/machinery"],
  [TOOLS_DIR, "entrypoints/tools"],
];

/** Where `deployed` is built from, relative to `src/`. */
export function sourceOf(deployed: string): string {
  const found = BUILT_FROM.find(([target]) => target === deployed);
  if (!found) throw new Error(`machinery-layout: nothing builds ${deployed}`);
  return found[1];
}

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
 *   - `setfacl -R` grants the tool user read on `ATOMA_MACHINERY_ROOT`. A path
 *     outside it is unreadable to the servers, and the symptom is "no server
 *     started" rather than "that path was wrong".
 *   - `governed_paths` defaults to `.github/**`, which is what keeps a change to a
 *     model, a tool list or a role prompt in a person's hands. A redirected
 *     `agent-definitions/` leaves that gate permanently, on one approval that
 *     reads as tidying.
 *   - Both upgrade paths — `cp -r self/. .github/` here, `unzip -o` for an
 *     adopter — replace by POSITION. A redirected tree is never upgraded again,
 *     and the new upstream copy lands beside it unread.
 *
 * And one of these can never be a setting whatever is decided about the rest:
 * `.github/scripts/` holds the programs that open the configuration. A file
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
 * each spelled `.github/atoma/...` for themselves. Nothing failed, because they
 * agreed — which is exactly how a set of literals stays wrong once one of them
 * moves.
 *
 * `validate_deliverable.ts` is the deliberate exception and does not import this.
 * It validates a pull request's OWN `.github/atoma/`, which is data to it and
 * never code; taking its paths from that tree would let a pull request redirect
 * the validation that is judging it.
 */

/** The root every other path here is relative to, and the root the ACL and the governance gate are written against. */
export const MACHINERY_ROOT = ".github/atoma";

/**
 * The one path that cannot come from configuration, named here rather than left
 * as the literal nobody mentions.
 *
 * `secret-slots.ts` reads it with `git show refs/atoma/trusted-config:<this>` —
 * out of the default branch's object store, before any file exists on disk.
 * That read is a security boundary: it is what stops a pull request declaring
 * which credentials it may reach.
 */
export const CONFIG_FILE = `${MACHINERY_ROOT}/config.json`;

/** Agent definitions: one file per agent, frontmatter plus the role prompt. */
export const AGENT_DEFINITIONS_DIR = `${MACHINERY_ROOT}/agent-definitions`;

/** The system prompt every agent's role prompt is placed into. */
export const PROMPT_TEMPLATE = `${MACHINERY_ROOT}/prompt-template.md`;

/** Skills: instructions loaded on demand, addressed by `<category>/<name>`. */
export const SKILLS_DIR = `${MACHINERY_ROOT}/skills`;

/** The tool servers a run may start, in the format the core reads. */
export const TOOLS_FILE = `${MACHINERY_ROOT}/tools/tools.yaml`;

/**
 * Hook scripts.
 *
 * Not passed to the core: it resolves a hook path against the tools file's own
 * directory, so this constant exists for the steps that must grant access to the
 * directory rather than for anything that names it to `atoma`.
 */
export const TOOL_HOOKS_DIR = `${MACHINERY_ROOT}/tools/scripts/hooks`;

/** npm packages the tool servers need, installed before a run and cached by this file's hash. */
export const MCP_PACKAGES_FILE = `${MACHINERY_ROOT}/mcp-packages.json`;

/** Branch rulesets, in GitHub's own import format rather than this project's. */
export const RULESETS_DIR = `${MACHINERY_ROOT}/rulesets`;

/**
 * The scripts the workflows run.
 *
 * Outside `MACHINERY_ROOT` because GitHub fixes `.github/workflows/`, and a
 * workflow step naming a script somewhere else would be naming a second root.
 */
export const SCRIPTS_DIR = ".github/scripts";

/** What the deployed release is, written by the deploy and read to decide whether an upgrade is due. */
export const RELEASE_MANIFEST = ".github/atoma-release.json";

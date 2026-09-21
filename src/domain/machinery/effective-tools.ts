/**
 * effective-tools.ts — the tool sets that are a promise, written out as SETS rather
 * than as the patterns that are supposed to produce them.
 *
 * ## What `files_readonly` rests on, and what nothing was checking
 *
 * `files_readonly` is the same program as `files` — one `mcp/files.ts`, six tools,
 * three of which write. What makes the read-only one read-only is a single
 * `tool_allowlist` in `tools/defaults.yaml`. `files_guard.ts` counts search misses
 * and stops nothing; no second mechanism withholds `edit` or `write`. The allowlist
 * is the whole of it.
 *
 * Two ways that can stop holding, and neither leaves a dead pattern behind, so
 * neither is visible to the check that looks for one:
 *
 *   1. **The list mechanism stops being applied.** Measured, in atoma: a server with
 *      `unprefixed: true` gives its tools their own names, `"read".split("__")` could
 *      not resolve which server a name belonged to, and every hook that server
 *      declared — allowlist and denylist alike — was silently skipped. Every pattern
 *      still matched a tool the server offered, so nothing was dead and nothing was
 *      reported. `files_readonly` is `unprefixed: true`. The fix was to route by name
 *      rather than split it; what is missing here is any way to notice the next one.
 *   2. **An entry is deleted.** A pattern that is not there matches nothing and is
 *      reported as nothing. Removing `read` widens the server by one tool and
 *      produces no finding at all.
 *
 * A check that reads patterns cannot see either. Only the set of tools the agent is
 * actually handed can, which is why what is written below is that set.
 *
 * ## Why these names are typed out rather than read from the configuration
 *
 * Deriving the expectation from `defaults.yaml`'s own `tool_allowlist` is the obvious
 * saving and it destroys the check: case 2 above edits that list, so the expectation
 * would move with the defect and the comparison would pass. The expectation has to be
 * a second, independent statement of the same promise — which is exactly what makes
 * it fail when the first one changes. Two spellings that must agree is the mechanism,
 * not a duplication to remove.
 *
 * This is a claim about what Atomaton ships. A project that overrides one of these
 * servers in its own `config.yaml` until it advertises something else fails here, and
 * that is the intent: `files_readonly` is a guarantee an adopter's reviewer agent is
 * relied upon to hold, not a default to be re-pointed quietly.
 */

/**
 * The namespace the core keeps for the tools it adds itself — `load_skill` today.
 *
 * Filtered out before comparing, because nothing in this repository's configuration
 * decides whether they are there: they arrive with the binary, and a check that
 * listed them would fail on an atoma upgrade that had broken nothing. What is being
 * asserted is what the SERVER contributes.
 */
export const CORE_TOOL_PREFIX = "atoma_builtin__";

/** A server whose advertised tools are fixed, and the reason they are. */
export interface ExactToolSet {
  /** The server as `tools/defaults.yaml` names it. */
  readonly server: string;
  /** Every tool it may advertise, and no others. Names as the agent sees them. */
  readonly tools: readonly string[];
  /** What is lost if this stops being true. Printed with a failure. */
  readonly promise: string;
}

/**
 * Every server this repository makes a fixed promise about.
 *
 * Two, and not more by accident: a server belongs here when its whole purpose is what
 * it does NOT offer. `files` is absent because its six tools are its feature, and
 * `github`, `web`, `search` and `atomaton` are absent because a tool added to one of
 * them is a capability rather than a hole.
 */
export const EXACT_TOOL_SETS: readonly ExactToolSet[] = [
  {
    server: "files_readonly",
    // `mcp/files.ts` offers `read, grep, glob, edit, write, list`. These are the three
    // that write, left out — so `edit` or `write` appearing here is the allowlist
    // having stopped applying, whatever the reason.
    tools: ["read", "grep", "glob", "list"],
    promise:
      "files_readonly is the same program as files, and only its tool_allowlist keeps edit and write " +
      "away from the agents that must not change the tree — the reviewer and the orchestrator.",
  },
  {
    server: "atomaton_env",
    // `mcp/atomaton.ts` also offers `launch_sub_agent` and `request_close_issue`.
    // Withholding them is what keeps an engineer from closing the issue it is
    // working on.
    tools: ["atomaton_env__reload_environment"],
    promise:
      "atomaton_env is the atomaton server with its other two tools withheld, so an engineer can rebuild " +
      "its environment and cannot close its own issue or dispatch another agent.",
  },
];

/** What a server advertised that it should not have, and what it did not advertise. */
export interface ToolSetMismatch {
  readonly server: string;
  /** Advertised and not expected — the direction a guard failing open takes. */
  readonly unexpected: readonly string[];
  /** Expected and not advertised — a server that has lost a tool, or has not started. */
  readonly missing: readonly string[];
}

/**
 * The tools a server contributed, with the core's own removed.
 *
 * Takes what the agent was handed for a definition naming ONE server, which is why it
 * can be a filter rather than an attribution: with one server in the definition every
 * remaining name is that server's. Keying on `server__` instead would read an
 * `unprefixed` server's six tools as zero — the shape `probe-tool-servers.ts` was
 * caught by once already.
 */
export function serverContributed(advertised: readonly string[]): string[] {
  return advertised.filter((name) => !name.startsWith(CORE_TOOL_PREFIX));
}

/**
 * Hold one server's advertised tools to its set, exactly.
 *
 * Both directions, and the less obvious one earns its place: a `missing` tool is how
 * a server that came up empty, or one whose allowlist has gone from narrowing to
 * forbidding, becomes a failure rather than a pass over an empty list. An expectation
 * that only refused extras would be satisfied by a server offering nothing.
 */
export function compareToolSet(expected: ExactToolSet, advertised: readonly string[]): ToolSetMismatch | undefined {
  const seen = new Set(serverContributed(advertised));
  const allowed = new Set(expected.tools);
  const unexpected = [...seen].filter((name) => !allowed.has(name)).sort();
  const missing = expected.tools.filter((name) => !seen.has(name));
  if (unexpected.length === 0 && missing.length === 0) return undefined;
  return { server: expected.server, unexpected, missing };
}

/** One line a person can act on, naming what changed and what it costs. */
export function describeMismatch(expected: ExactToolSet, mismatch: ToolSetMismatch): string {
  const parts: string[] = [];
  if (mismatch.unexpected.length > 0) {
    parts.push(`advertises ${mismatch.unexpected.join(", ")}, which it must not`);
  }
  if (mismatch.missing.length > 0) {
    parts.push(`does not advertise ${mismatch.missing.join(", ")}, which it must`);
  }
  return (
    `${expected.server} ${parts.join("; and ")}. Expected exactly {${expected.tools.join(", ")}}. ` +
    expected.promise
  );
}

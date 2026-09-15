/**
 * types.ts — shared type definitions, the one canonical copy used by every
 * script and MCP server in this repo.
 */

// `AutoTrigger` was re-exported from here. It and its module are gone: nothing read
// the setting at run time. See `AtomaConfig` below for what it used to mean.
// `AutoTrigger` belonged to `domain/auto-triggers.ts`, which owned the rules that
// give `condition` its meaning. It used to be declared here, in a file with no
// way to evaluate it — so the type listed three condition values while the
// matcher implemented two, and nothing connected the two lists.
//
// Re-exported so the many callers that import their config types from one place
// keep working. `domain/` is the definition; this is a doorway to it, not a
// second copy.
/**
 * `.github/atoma/config.yaml`, as the readers in `lib/config.ts` see it.
 *
 * Grouped by who consumes the value. Every field is optional because a project
 * that declares nothing still runs -- the readers carry the defaults, in one place
 * each, so two callers cannot disagree about what an absent setting means.
 *
 * The reasons are in `docs/configuration.md` rather than here. They used to be in
 * both, and a reason written twice is a reason that will disagree with itself.
 */
export interface AtomaConfig {
  /** Where work branches from and merges back to. Empty means the default branch. */
  base_branch?: string;

  /** What has to be installed before checks, deployments and agent runs. */
  environment?: {
    setup_commands?: string[];
    /** Bounds environment rebuilds. The refusal goes to the agent, which carries on. */
    max_reloads?: unknown;
  };

  /** How a change is verified. Exactly one arm; declaring both is a configuration error. */
  checks?: {
    atoma_runs?: {
      commands?: string[];
      secrets?: string[];
      runs_on?: string | string[];
    };
    your_workflow?: string;
  };

  /** How a merged change ships. The same two arms. */
  deploy?: {
    atoma_runs?: {
      /** Validated by `resolveDeployTargets`, which owns what a malformed one means. */
      targets?: unknown;
      secrets?: string[];
      runs_on?: string | string[];
    };
    your_workflow?: string;
  };

  /** When a person, not an agent, performs the merge. Any member firing is enough. */
  merge?: {
    policy?: "auto" | "manual" | string;
    governed_paths?: string[];
    /** Validated by `resolveMergeGates`, which owns what a malformed one means. */
    gates?: unknown;
  };

  /** When a chain of runs stops and asks a person. */
  chain?: {
    after_handoffs?: unknown;
    after_runs_without_change?: unknown;
    /** State one run leaves for the next, not presentation. */
    labels?: {
      in_progress?: string;
      sub_issue?: string;
      launched?: string;
      [key: string]: string | undefined;
    };
  };

  /**
   * What an agent can reach, and under what watch.
   *
   * `servers` is passed through to the core's own tools-file format verbatim, so a
   * key the core gains works here the day it ships. `settings` is the one key this
   * project reserves inside a server entry: the generator strips it, and the server
   * reads it back through `lib/config.ts`.
   */
  tools?: {
    secrets?: string[];
    watch?: Record<string, string>;
    // Not enumerated, and `settings` is not either: the runtime schema passes every
    // key inside a server entry through, so naming them here would make the two
    // disagree about what a known key is -- which a contract test catches, and which
    // would otherwise surface as an adopter's valid config being refused.
    servers?: Record<string, Record<string, unknown>>;
  };
}

/** Minimal shape of `gh issue view --json author` (NOT the REST `.user.type` shape). */
export interface GhIssueAuthor {
  author?: {
    is_bot?: boolean;
    login?: string;
  };
}

export interface GhIssueSummary {
  number: number;
  title: string;
  state: string;
  labels?: { name: string }[];
}

export interface GhPrSummary {
  number: number;
  title: string;
  url: string;
}

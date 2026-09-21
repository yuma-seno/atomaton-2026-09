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
 * `.github/atomaton/config.yaml`, as the readers in `adapters/runner/config.ts` see it.
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

  /**
   * How a change is verified. Exactly one arm; declaring both is a configuration error.
   *
   * `from_pull_request` is named for whose code runs: the commands the pull request
   * itself declares, in its own tree. It reaches no repository secret, and there is
   * nowhere here to name one -- a pull request may rewrite any command it lists, so a
   * credential would be one the change being judged can read.
   *
   * A check that needs a credential therefore has nowhere to go yet. That half is the
   * default branch's commands given the pull request as data, and it is not built.
   */
  checks?: {
    /**
     * The pull request's own commands, each entry its own job.
     *
     * Validated by `resolveDeclaredJobs`, which owns what a malformed one means and
     * refuses a secret named here -- see `domain/delivery/declared-jobs.ts` for why there is
     * nowhere to write one.
     */
    from_pull_request?: unknown;
    /** The default branch's commands. These may name secrets. */
    from_default_branch?: unknown;
    your_workflow?: string;
  };

  /**
   * How a merged change ships: one list per event that ships it, or a workflow of
   * your own. Declaring both is a configuration error.
   *
   * Three lists rather than one with an `on:` key, because the entries are not the
   * same shape — a merge deployment is selected by branch and a tag deployment by
   * tag pattern. `resolveDeployJobs` owns their interior, including which of
   * `branches:` and `tags:` each list has; see `domain/delivery/deploy-jobs.ts` for why the
   * combination nobody should write has no spelling.
   */
  deploy?: {
    /** Deploys when a change lands on a branch. Naming none means the default branch. */
    on_merge?: unknown;
    /** Deploys when a matching tag is pushed. */
    on_tag?: unknown;
    /** Deploys only when someone dispatches the workflow. */
    on_demand?: unknown;
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
   * What an agent can reach beyond what Atomaton ships, and under what extra watch.
   *
   * Additive. The eight servers a run starts with and the hooks that watch all of
   * them are in `domain/machinery/shipped-servers.ts`, not here: deleting one breaks a run, and
   * the file this interface describes is the one an adopter is told is theirs. See
   * that module for the line -- hide what breaks when edited wrong, show what
   * degrades.
   *
   * `servers` is passed through to the core's own tools-file format verbatim, so a
   * key the core gains works here the day it ships. A name Atomaton ships is overridden
   * field by field; a name it does not is added. `settings` is the one key this
   * project reserves inside a server entry: the generator strips it, and the server
   * reads it back through `adapters/runner/config.ts`.
   */
  tools?: {
    secrets?: string[];
    /**
     * Hooks appended to the machinery's, per hook key.
     *
     * A string or a list of them. Both reach the core, which has accepted both since
     * v0.1.33 -- its `Hooks` always held a list and only the tools file's shape was
     * singular, which left a delivery shipping a required hook with no way to let a
     * project add one beside it.
     */
    watch?: Record<string, string | string[]>;
    // Not enumerated, and `settings` is not either: the runtime schema passes every
    // key inside a server entry through, so naming them here would make the two
    // disagree about what a known key is -- which a contract test catches, and which
    // would otherwise surface as an adopter's valid config being refused.
    servers?: Record<string, Record<string, unknown>>;
    /**
     * Packages a server of YOUR OWN needs, installed before a run.
     *
     * The shipped servers name theirs in the deliverable, beside their own
     * declarations, because they are not a project's decision. This is the other
     * half: a server you added under `servers` that is started by a binary, or that
     * imports something the bundle cannot carry.
     *
     * Both lists are installed as one set, and both are hashed into the cache key.
     */
    packages?: { npm?: string[]; bun?: string[]; pip?: string[] };
  };
}


/**
 * wire-types.ts — the shapes `gh` hands back, narrowed to what this repository reads.
 *
 * Each one is a SUBSET of a real response, written for one flag combination. The
 * comment on `GhIssueAuthor` is the reason they are worth naming at all: `gh issue
 * view --json author` and the REST API describe the same fact with different keys,
 * and a type that does not say which one it is is a type that will be given the
 * other.
 *
 * Here rather than in `domain/`, because none of this is the work's vocabulary — it
 * is the wire's. They used to sit in `domain/delivery/declared-config.ts` beside `AtomaConfig`, which is
 * the opposite thing: what a project DECLARES, now `domain/delivery/declared-config.ts`.
 * One module holding both is how a layer boundary gets crossed without anybody
 * writing an import that looks wrong.
 */

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

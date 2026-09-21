/**
 * issue-links.ts — what an issue is attached to, and which attachments count.
 *
 * The relationships an issue has are the difference between reading a comment
 * correctly and reading it wrong. "Implemented it" on a sub-issue means a part
 * was implemented, not the feature. "We decided X" reads as settled when the
 * pull request carrying X is merged, and as a proposal when it is still open.
 * Neither is recoverable from the comment text.
 *
 * These are read from GitHub's own relationships rather than from Atomaton's
 * markers, because an issue a person drove by hand has no Atomaton markers on it
 * and is exactly the case that must not silently come back empty.
 *
 * Pure. The GraphQL half lives in `adapters/github/issue-links.ts`.
 */

export interface LinkedIssue {
  number: number;
  title: string;
  /** GitHub's state, lowercased: "open" or "closed". */
  state: string;
}

/**
 * A sub-issue, with what a gate needs to judge it.
 *
 * `labels` is here and not on [`LinkedIssue`] because only the children are judged:
 * `sibling-check.ts` counts the ones Atomaton dispatched, and `work-tree.ts` needs to
 * know which are running before it stops a subtree. A parent or a pull request is
 * shown, not judged.
 *
 * It is also why the tool surface projects it away. These arrive in the same request
 * as the rest — one query, no extra round trip — but a label array per child in every
 * `get_issue` response is tokens spent on something no reader asked for.
 */
export interface LinkedChild extends LinkedIssue {
  readonly labels: readonly string[];
}

export interface LinkedPr extends LinkedIssue {
  /**
   * Whether it landed.
   *
   * Separate from `state` because GitHub says only `closed` for both a merged
   * pull request and an abandoned one, and those mean opposite things to
   * someone reading "we decided to do X" in the discussion above.
   */
  merged: boolean;
}

export interface IssueLinks {
  parent?: LinkedIssue;
  children: LinkedChild[];
  pullRequests: LinkedPr[];
  /**
   * Why the links could not be read, when they could not.
   *
   * Absent means the lists above are the answer. Present means they are empty
   * because nobody could look, which is a different fact -- and the one
   * `get_issue_comments`' header rests its whole value on: "'Implemented it'
   * on a sub-issue whose pull request is still open is a proposal, not a
   * fact." A failed read silently produced exactly the reading that comment
   * exists to prevent.
   *
   * Not throwing stays right -- this decorates a read that already succeeded.
   * Reporting the degradation is the part that was missing.
   */
  unavailable?: string;
}

/**
 * GitHub's closing keywords, as GitHub documents them.
 *
 * Matching these ourselves is not a preference for reinventing the parser. It
 * is the only way to see a sub-issue's pull request at all: GitHub forms its
 * own closing link only for pull requests that target the default branch, and
 * Atomaton aims a sub-issue's pull request at its parent's branch. Measured on
 * this repository, #281's `Closes #281` in PR #284 produced no native link
 * because the pull request targeted `atomaton/issue-280`, while the parent's did because its pull
 * request targeted `main`.
 */
/**
 * Every keyword GitHub acts on, and only those.
 *
 * Checked against the documentation rather than remembered: close/closes/closed,
 * fix/fixes/fixed, resolve/resolves/resolved, and nothing else. Case and an optional
 * colon are handled where this is used, since GitHub accepts `CLOSES: #10` too.
 *
 * One definition because three callers read it, and a keyword missing from one of them
 * is a hole nobody sees: the reader would report no link, and the guard would allow what
 * it exists to stop.
 */
const CLOSING_KEYWORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";

/**
 * Whether a pull request body claims to close this issue.
 *
 * Used to tell the pull request doing the work from one that merely mentioned
 * the issue in passing — a distinction the cross-reference timeline does not
 * make, and `willCloseTarget` does not answer either: it reports `false` for
 * #284 despite the `Closes #281` in its body.
 */
export function claimsToClose(body: string, issue: number): boolean {
  return new RegExp(`\\b(?:${CLOSING_KEYWORDS})\\s*:?\\s+#${issue}\\b`, "i").test(body);
}

/**
 * The issue a pull request body claims to close, if it claims to close one.
 *
 * The same keywords as [`claimsToClose`], asked the other way round: that one is given
 * a number, this one finds it. Both exist because two callers need different questions
 * of one rule, and until now the second caller wrote its own `/Closes #(\d+)/` —
 * case-sensitive, one space, one keyword. A body saying `closes #12` matched the
 * injector that decides whether to ADD such a line (case-insensitive, so it added
 * nothing) and did not match the parser, so `sub_number` came out empty and every job
 * gated on it was skipped: the parent was never notified and the sub-issue's results
 * never reached the orchestrator's session. Green, and silent.
 */
export function closedIssueNumber(body: string): number | undefined {
  const match = new RegExp(`\\b(?:${CLOSING_KEYWORDS})\\s*:?\\s+#(\\d+)\\b`, "i").exec(body);
  return match ? Number(match[1]) : undefined;
}

/**
 * Every closing reference in a piece of text, in the order they appear.
 *
 * Asked of text an agent wrote, before it becomes something GitHub will act on. The two
 * readers above take a body that already exists and ask what it links to; this asks
 * whether a body should be allowed to exist as written, so it has to catch forms those
 * two deliberately do not.
 *
 * ## Why this one matches more than the others
 *
 * GitHub documents two reference syntaxes after a keyword:
 *
 * ```text
 *   Closes #10                          same repository
 *   Fixes octo-org/octo-repo#100        another repository
 * ```
 *
 * `claimsToClose` and `closedIssueNumber` read only the first, correctly: they answer
 * questions about issues in *this* repository, and a cross-repository reference is not
 * one. A guard cannot share that blind spot. A closing keyword aimed at another
 * repository is the more dangerous of the two, because nothing in this repository shows
 * it happened — measured here, the form has never been written, which is exactly the
 * kind of thing that is true until it is not.
 *
 * ## What is skipped
 *
 * Code spans and fenced blocks, because GitHub does not act on a keyword inside one and
 * neither should a rule about it. Documentation explaining `Closes #N` is not an attempt
 * to close anything, and refusing it would make the rule unwritable in its own docs.
 */
export function closingReferences(text: string): string[] {
  const pattern = new RegExp(
    `\\b(?:${CLOSING_KEYWORDS})\\s*:?\\s+((?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#\\d+)\\b`,
    "gi",
  );
  const found: string[] = [];
  for (const segment of outsideCode(text)) {
    for (const match of segment.matchAll(pattern)) {
      const whole = match[0].trim();
      if (!found.includes(whole)) found.push(whole);
    }
  }
  return found;
}

/**
 * Why a piece of agent-written text cannot be sent as it stands, or nothing.
 *
 * A refusal rather than an escape, which is the opposite of what `mention.ts` does to a
 * mention it cannot vouch for. The difference is what is left behind: an escaped mention
 * reads as a name somebody wanted to reach, while an escaped \`Closes #1\` is litter in a
 * pull request a person has to read past. Refusing gets the body rewritten, so the human
 * receives the corrected version and nothing else.
 *
 * It names the route that does work. Measured three times in this project on three
 * different guards: a refusal that says what to do instead is followed, and one that
 * only states a rule is not.
 */
export function closingKeywordRefusal(found: readonly string[], what: string): string | undefined {
  if (found.length === 0) return undefined;
  const quoted = found.map((f) => `"${f}"`).join(", ");
  return (
    `This ${what} contains ${quoted}, which GitHub acts on: merging would close ` +
    "whatever issue that names, without going through the path that cleans up labels and " +
    "tells a parent its child is done. Remove it and try again. To close an issue, call " +
    "github__close_issue; to link this work to the issue it belongs to, do nothing -- " +
    "that link is added for you."
  );
}

/** A fenced code block, or an inline code span. The same rule `mention.ts` uses. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

/** The parts of `text` that are not inside code. */
function outsideCode(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    const at = match.index ?? 0;
    out.push(text.slice(last, at));
    last = at + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}


/** Combine link lists from several sources, first mention of a number winning. */
export function dedupeByNumber<T extends { number: number }>(...lists: T[][]): T[] {
  const seen = new Map<number, T>();
  for (const list of lists) for (const item of list) if (!seen.has(item.number)) seen.set(item.number, item);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

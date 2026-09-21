/**
 * tags.ts — canonical encode/decode for every `<!-- atomaton:xxx=... -->`
 * HTML-comment marker Atomaton embeds in issue/PR bodies and comments to carry
 * state across otherwise-stateless GitHub Actions workflow runs.
 *
 * This is the ONE place each tag's
 * wire format is defined; every reader/writer imports from here instead of
 * re-deriving its own regex.
 */
import { AGENT_NAME_PATTERN } from "./agent-name.ts";

/**
 * The prefix every tag carries, written once.
 *
 * It was written twice -- once in the regex and once in the renderer -- and the
 * two agreed, so a rename that moved every literal `atoma:<key>` in the codebase
 * left both of these behind: `atoma:${key}` has a `$` after the colon, not a
 * letter, so a pattern written for the literals could not see them. The readers
 * then expected one prefix and the writer produced the other.
 */
const TAG_PREFIX = `atomaton:`;

export interface AtomatonTag<T> {
  /** Render this tag's HTML-comment form, ready to prepend/embed in a body or comment. */
  write(value: T): string;
  /** Extract this tag's value from anywhere in `text`, or undefined if absent. */
  read(text: string): T | undefined;
  /** True if `text` contains this tag at all, regardless of its value. */
  has(text: string): boolean;
  /**
   * What to put in a GitHub search to find bodies carrying this tag with this value.
   *
   * The tag's own text without the comment wrapper, because GitHub's search does not
   * match `<!-- ... -->` — measured: a tree walk searching for `write()`'s output found
   * none of its children, on a repository where every one of them carried the tag.
   *
   * Never the predicate. GitHub tokenizes, so a search for `atomaton:parent-issue=5`
   * also returns the pull requests of #50; every hit is confirmed with `read`
   * afterwards.
   */
  search(value: T): string;
}

/**
 * The wire form of every tag defined below, collected as each one is made.
 *
 * `withoutTags` reads this rather than a second list, so a tag added later is
 * stripped from the moment it exists. A list written by hand would be the same
 * fact in two places, and the half that falls behind is the half that leaks.
 */
const EVERY_TAG_PATTERN: string[] = [];

function makeTag<T>(key: string, valuePattern: string, parse: (raw: string) => T, render: (value: T) => string): AtomatonTag<T> {
  const pattern = `<!--\\s*${TAG_PREFIX}${key}=(?:${valuePattern})\\s*-->`;
  EVERY_TAG_PATTERN.push(pattern);
  const re = new RegExp(`<!--\\s*${TAG_PREFIX}${key}=(${valuePattern})\\s*-->`);
  return {
    write: (value) => `<!-- ${TAG_PREFIX}${key}=${render(value)} -->`,
    read: (text) => {
      const m = re.exec(text);
      return m ? parse(m[1]!) : undefined;
    },
    has: (text) => re.test(text),
    search: (value) => `${TAG_PREFIX}${key}=${render(value)}`,
  };
}

/** Numeric-valued tag, e.g. `atomaton:foo=42`. */
function numericTag(key: string): AtomatonTag<number> {
  return makeTag(key, "\\d+", Number, String);
}

/** String-valued tag, e.g. `atomaton:foo=bar-baz`. */
function stringTag(key: string, valuePattern: string): AtomatonTag<string> {
  return makeTag(key, valuePattern, (raw) => raw, (value) => value);
}

/**
 * A human asked the run on this issue/PR to stop.
 *
 * Written by `request_stop.ts` on the comment it posts, and polled for by the running
 * job itself -- which is the whole reason it is a comment and not a label or a file.
 * Nothing outside a job can reach into that job's filesystem, so the signal has to be
 * somewhere both sides can see, and a comment is also the record of who asked and
 * when.
 *
 * The reader must ignore requests older than its own run. A stop from last week is
 * not a stop of this run, and a job that read one would refuse to start work.
 */
export const STOP_TAG = stringTag("stop", "requested");

/**
 * How a run ended, written on its own result comment.
 *
 * Asked by `/resume` over a work tree: "which nodes under this one were stopped?" is
 * a question about the thread, and without this it could only be guessed from the
 * presence of a session — which almost every node that ever ran has. The thread
 * already carries `AGENT_TAG` for the same kind of question (`resolve_resume_agent.ts`
 * reads it to name the agent), so the ending goes beside it rather than into a store
 * that would have to be kept in sync.
 *
 * `stopped` is a person's stop or a closed issue's; `limit` is a spent iteration or
 * time budget; `done` is every ordinary ending. Only the first is resumed
 * automatically, because only it was interrupted rather than finished.
 */
export const ENDED_TAG = stringTag("ended", "stopped|limit|done");

// `PARENT_TAG` (`atomaton:parent`, sub-issue -> parent issue) was here. GitHub's own
// sub-issue link answers the same question and a person can change it, while this was
// written once at creation and never rewritten -- so re-parenting in the web UI left
// two answers in the system with nothing to say they differed. `lib/parent-issue.ts`
// carries the measurement and the argument.

/**
 * PR -> the issue it was created to deliver (set via `github__create_pr`).
 *
 * ## Why this one stays when the issue-to-issue tag went
 *
 * Not symmetry, and not habit: GitHub's own PR-to-issue link does not survive in this
 * design, and that was measured rather than assumed. Of the nine pull requests this
 * repository had tagged, SEVEN carried a correct `Closes #N` line and only TWO
 * appeared in `closingIssuesReferences`.
 *
 * GitHub drops the link once the issue is closed by anything other than that pull
 * request's merge, and two things here do exactly that:
 *
 *   - A sub-issue's pull request merges into its PARENT's branch, not the default
 *     one, so GitHub's auto-close never fires for it at all. That is the stacking
 *     design in `branch-placement.ts`, chosen so sub-issues can see each other's work.
 *   - After a merge, `dispatchPostMergeAgent` re-invokes the agent to confirm and
 *     close the sub-issue. By the time it does, the link is gone.
 *
 * So the edge exists and GitHub will not keep it. Making it keepable means giving up
 * stacking or giving up the post-merge confirmation, which is a larger question than
 * where a number is written down.
 */
export const PARENT_ISSUE_TAG = numericTag("parent-issue");
/** Who to `@mention` on completion/escalation. */
export const NOTIFY_TAG = stringTag("notify", "[A-Za-z0-9-]+");
/** Which agent originally created a PR (for post-merge/rejection re-invocation). */
export const ORIGIN_AGENT_TAG = stringTag("origin-agent", AGENT_NAME_PATTERN);
/** Slash-command-equivalent dispatch marker on a bot-authored comment. */
export const DISPATCH_TAG = stringTag("dispatch", AGENT_NAME_PATTERN);
/** Tags a posted result comment with which agent generated it (used by reconcile_github_session.ts to exclude an agent's own past comments from its future shared context). */
export const AGENT_TAG = stringTag("agent", AGENT_NAME_PATTERN);

/**
 * Whether the run that posted this comment changed anything.
 *
 * `yes` when it pushed a commit, opened a pull request or merged one; `no` when it
 * ran and left the repository as it found it. Read by `domain/work/progress.ts`, which
 * counts consecutive `no`s rather than keeping a counter -- see `dispatch-chain.ts`
 * for why a counter in the session could not work.
 */
export const CHANGED_TAG = stringTag("changed", "yes|no");
/** Marks a GitHub comment as human-visible operational audit only; excluded from future LLM context reconciliation. */
export const LLM_CONTEXT_TAG = stringTag("llm-context", "include|exclude");
/** Idempotency marker: orchestrator dispatch was already triggered for a given closed sub-issue's completion (see lib/aggregation.ts). Fresh tag with no pre-existing data, written as plain `N`. */
export const AGGREGATED_TAG = numericTag("aggregated");
/** Progress marker: which sub-issue's completion a progress comment reports on. Write-only (nothing parses it back); written as plain `N`. */
export const SUB_RESULT_TAG = numericTag("sub-result");
/**
 * Counts how many times validation has sent a pull request back to the engineer.
 *
 * The auto-dispatch counter in `manage_dispatch_loop.ts` cannot bound this loop:
 * it only advances on a directive the agent itself wrote, and here the engineer
 * is dispatched by the validation workflow instead. So CI failing, the engineer
 * pushing, and CI failing again would repeat without limit, each turn costing a
 * model run. Counting the comments validation leaves is what stops it, and the
 * comments are worth leaving anyway -- they are where the engineer reads which
 * job failed.
 */
export const CI_RETRY_TAG = numericTag("ci-retry");

// `readAnyParentTag` was here: `PARENT_TAG.read(text) ?? PARENT_ISSUE_TAG.read(text)`,
// for a walk that did not know whether it held an issue or a pull request. With one
// tag left there is nothing to choose between, and the one caller that walks upward
// asks GitHub which kind it is looking at -- see `lib/notify.ts`.

/**
 * `text` with every Atomaton tag removed.
 *
 * These markers exist to carry state between workflow runs through GitHub, which
 * means they live in issue bodies, pull request bodies and comments -- exactly the
 * text that becomes an agent's context. Nothing removed them on the way in, so an
 * agent read its own delivery machinery's bookkeeping as part of the conversation:
 * who to mention, whether the last run changed anything, and -- the one that gives
 * the shape away -- `llm-context=exclude`, a note saying this must not reach the
 * model, reaching the model.
 *
 * A tag on a line of its own takes the whole line with it, line ending included.
 * `
` as well as `
`: the machinery writes its comments through `gh --body` and gets
 * `
`, but an issue or pull request body a person edited in the browser comes back
 * with `
`, and those are the bodies `parent`, `notify` and `origin-agent` live in.
 * Matching only `
` left a stray carriage return and a blank line at the top of exactly
 * the text a person had touched.
 *
 * A tag inside a line takes the spacing on its right, so removing it reads as removing
 * a word rather than leaving a gap where one was.
 *
 * The line ending may also arrive written rather than typed. A tool server hands a
 * pull request body back inside a JSON document, where the newline after a tag is
 * the two characters `\` and `n`; matching only a real one left those behind as
 * escapes, so the body read as starting with blank lines.
 *
 * Only a tag with a real value is removed. Prose about the tags -- an issue
 * discussing `<!-- atomaton:parent=N -->` -- does not match the value patterns and
 * survives, which is what keeps this from quietly editing a conversation about
 * itself.
 */
export function withoutTags(text: string): string {
  const tags = EVERY_TAG_PATTERN.join("|");
  const lineEnd = String.raw`(?:\r?\n|(?:\\r)?\\n)?`;
  return text.replace(new RegExp(String.raw`(?:^[ \t]*)?(?:${tags})[ \t]*${lineEnd}`, "gm"), "");
}

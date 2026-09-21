/**
 * close-request.ts — the comment an agent leaves when closing an issue is not
 * its own to do.
 *
 * ## The defect
 *
 * Two tools conclude an issue, and both asked GitHub who opened it before doing
 * anything. A person's issue is not closed by an agent — that part was never in
 * question. What they did with the answer was:
 *
 * - `atomaton__request_close_issue` posted its comment and returned a normal
 *   result explaining that it had NOT closed the issue.
 * - `github__close_issue` returned a tool ERROR — "Refusing to close issue #N:
 *   opened by a human, not a bot" — and posted nothing at all.
 *
 * Measured across the runs held at the time: 30 refusals, 22 of them the last
 * act of the run. The agent, handed a refusal at the moment it had decided it
 * was finished, wrote the refusal into its report — so the person reading the
 * thread got a paragraph of tool mechanics they had not asked about, and in the
 * `github__close_issue` half got no request to close anything either, because an
 * error posts no comment. #933 is one of those reports.
 *
 * ## The rule
 *
 * Whether a person or an agent opened the issue is the TOOL's question, not the
 * agent's. Calling a close tool means "I am done here" and ends the session
 * either way; the tool decides whether it may close, and when it may not, the
 * comment it was going to post anyway gains one line at the top asking the
 * person to close it. Nothing errors, and nothing in the agent's result invites
 * it to explain a decision it did not make.
 *
 * This module is the one place that line is written, so the two tools cannot
 * word it differently or forget it. Pure: the caller resolves who to mention and
 * what the agent had to say.
 */

export interface CloseRequest {
  /**
   * The login to ask, empty when nobody could be resolved.
   *
   * Empty is a real case and not an error — `resolveNotify` falls back to the
   * repository owner and returns `""` only when even that could not be read. The
   * request still gets posted: a comment nobody is pinged about is still on the
   * thread, and the alternative is an issue that silently stays open.
   */
  notify?: string;
  /** What the agent had to say about the work, posted underneath the request. */
  body?: string;
}

/**
 * The one line asking a person to close their own issue.
 *
 * Exported for the tests and for anything that needs to recognise it; callers
 * building a comment want `closeRequestComment` below, which puts it where it
 * has to be.
 */
export const CLOSE_REQUEST_LINE =
  "**This issue was opened by a person, so please close it yourself if you agree that the work below is done.** " +
  "Atomaton leaves that to you; comment with further instructions instead if it is not done.";

/**
 * The comment to post when the close is the reader's to make.
 *
 * The request goes FIRST, above the agent's own reason and summary. It used to
 * be appended after them, which put the only sentence addressed to the reader
 * under however many paragraphs of report the agent had written — and the reader
 * is the one being asked to act.
 */
export function closeRequestComment(request: CloseRequest): string {
  const mention = request.notify ? `@${request.notify} ` : "";
  const body = (request.body ?? "").trim();
  const head = `${mention}${CLOSE_REQUEST_LINE}`;
  return body ? `${head}\n\n${body}` : head;
}

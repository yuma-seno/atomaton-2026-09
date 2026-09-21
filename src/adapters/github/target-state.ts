/**
 * target-state.ts — read whether an issue or pull request is open, closed, or merged.
 *
 * The one lookup behind every guard in `domain/work/closed-issue.ts`, which decides what to
 * do with the answer. Three callers need it — the slash-command guard, the stop-on-close
 * job, and `dispatchRunner` — and a fourth will be added by whoever adds the next way
 * to start an agent, so it is a function rather than three spellings of one `gh` call.
 *
 * ## Why the issues endpoint, and not `gh pr view` / `gh issue view`
 *
 * `GET /repos/{owner}/{repo}/issues/{n}` answers for both. `gh issue view` on a pull
 * request number refuses, and picking the right one first would mean already knowing
 * which kind of thing the number names — which is the trap #811 is about, one layer
 * down: `repository.issue(number:)` does not resolve a pull request either, and every
 * caller that passed one got an empty answer rather than an error.
 *
 * The same response carries `pull_request.merged_at`, which is the only way to tell a
 * merged pull request from a closed one. That distinction is not cosmetic: GitHub
 * cannot reopen a merged pull request, so a notice telling somebody to reopen one is
 * advice that cannot be taken.
 *
 * ## Why `ghRead`
 *
 * A failure here refuses to start work. That is the right answer for "this target is
 * closed" and the wrong one for "GitHub returned 504", and the two are indistinguishable
 * at this level — so the retry happens below, and only a failure that outlasts it
 * becomes `unknown`. Without that, a blip would stall a chain that had nothing wrong
 * with it.
 */
import { ghRead } from "./gh.ts";
import type { TargetState } from "../../domain/work/closed-issue.ts";

interface IssueOrPr {
  state?: string;
  pull_request?: { merged_at?: string | null };
}

/**
 * The state of `number` in `repo`, or `unknown` with the reason.
 *
 * `repo` may be empty when the caller runs inside a checkout of the repository it
 * means; `gh` fills the placeholders in from the remote. Never throws — the callers
 * all have something to say about not knowing, and none of them have anything to do
 * with an exception.
 */
export function readTargetState(number: number | string, repo?: string): TargetState {
  const path = repo ? `repos/${repo}/issues/${number}` : `repos/{owner}/{repo}/issues/${number}`;
  const { code, stdout, stderr } = ghRead("api", path);
  if (code !== 0) {
    return { kind: "unknown", why: (stderr || stdout || `gh exited ${code}`).trim().split("\n")[0] ?? "" };
  }

  let parsed: IssueOrPr;
  try {
    parsed = JSON.parse(stdout) as IssueOrPr;
  } catch {
    return { kind: "unknown", why: "the response was not JSON" };
  }

  // An unrecognised state is not "open". GitHub answers `open` or `closed` here, so a
  // third value means this is reading something it does not understand, and the
  // permissive reading is the one that lets work through.
  if (parsed.state === "open") return { kind: "open" };
  if (parsed.state === "closed") return { kind: "closed", merged: Boolean(parsed.pull_request?.merged_at) };
  return { kind: "unknown", why: `unrecognised state ${JSON.stringify(parsed.state ?? null)}` };
}

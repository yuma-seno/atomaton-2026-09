# What an agent's pull request meets

Opening one starts nothing by itself — [GitHub raises no event for its own
token](../work/how-it-works/github-raises-no-event-for-its-own-token.md) — so
`create_pr` dispatches `atomaton-validate-pr.yml` as its last act. That workflow
runs the configured CI on the branch, writes the result as a check run, and then
dispatches whoever the result calls for: the reviewer **named in the call** when it
is green, the engineer when it is not.

## When nobody is named to look at it

Asking explicitly means it can be forgotten. An agent that opens a pull request with
no `reviewer` and mentions nobody leaves work that nothing is scheduled to look at —
CI runs, the check goes green, and it waits.

So the machinery checks and says so, on the pull request:

> This pull request was opened by `engineer` with no reviewer named and nobody
> mentioned, so nothing is scheduled to look at it. CI still runs and its result
> stands. Comment `/reviewer` to have it reviewed, or take it from here.

Addressed to whoever the run resolves as the person to notify.

## When the check on the deliverable fails

Before your CI is asked to run at all, the pull request is checked for whether the
`.github/atomaton/` it would merge can still start a run —
[what a pull request is checked against](boundaries.md#what-a-pull-request-is-checked-against).

When that fails, the required check goes red, the problems are listed in a comment
on the pull request, and the engineer is dispatched to fix them — the same handling
as failing CI, including the retry limit. The agent sent to fix it is unaffected by
the breakage, because a run reads its machinery from
[the default branch](../pipeline/how-it-works.md) rather than from the pull request.

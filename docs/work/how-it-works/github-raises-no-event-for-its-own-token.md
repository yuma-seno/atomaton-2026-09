# GitHub raises no event for its own token

**GitHub starts no workflow run for events `GITHUB_TOKEN` triggers.** An agent's
issues, comments, pull requests and merges are all made with that token, so nothing
an agent does raises an event, and everything downstream of an agent's action is
dispatched explicitly instead.

- `create_pr` dispatches `atomaton-validate-pr.yml`. It cannot listen for the pull
  request it just opened.
- A merge is followed by an explicit dispatch of CI and deployment. Nothing
  downstream of it fires by itself, so a deployment chained off CI or off a push to
  the base branch would otherwise silently never run.
- A workflow that creates an issue — a weekly schedule, say — has to dispatch
  `atomaton-runner.yml` itself, in a last step that is not optional.

`atomaton-pr-merged.yml` is the one path that listens rather than being dispatched: it
uses `pull_request_target`, so a merge is detected whoever or whatever performed it.

This explains more of the machinery than any other single fact about it, which is
why it has a page of its own to be pointed at rather than a paragraph repeated in
each place it decides something.

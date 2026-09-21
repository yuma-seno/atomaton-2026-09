# Have something happen every week

Atomaton has no schedule setting, and will not grow one — but the thing you want is two
steps away, and both are ordinary.

Copy [`examples/workflows/scheduled-issue.yml`](../../../examples/workflows/scheduled-issue.yml)
into your own `.github/workflows/`, then edit four things in it: the cron, the issue
title, the issue body, and which agent the last step hands the issue to. If you run more
than one of these, the label it creates and matches on is the fifth — the example uses it
to avoid opening a second issue while the first is still open.

**You have to copy it yourself.** No agent can add a workflow for you —
[GitHub refuses one the write by identity](../../pipeline/overview.md) — and
`.github/**` is a governed path, so a person merges the pull request that adds it.
Both of those are the system working, not obstacles to route around.

**Why it creates an issue instead of starting an agent.** Agents work on an issue or a
pull request. Something you want done every week *is* a work item that should exist every
week — so the schedule creates the work item, and everything after that is the machinery
you already have: triggers, the in-progress label, session persistence, review, merge
gates. Nothing needs a schedule-only execution path. It also puts the cost where you can
see it: an issue is free, and whether it becomes an agent run is then an ordinary
decision rather than something a cron expression decided months ago and nobody has looked
at since.

**Why it is not a setting.** `on:` accepts no expression, so a cron string cannot come
from `config.yaml`. That is GitHub's rule, not a choice made here. The workaround — a
fixed daily cron that checks the date inside a script — was considered for deployments
and rejected, and is worse for agents: a deployment that no-ops costs a few seconds of
runner time, while an agent that starts and finds nothing to do costs a billed inference.

**The last step is not optional.** An issue created with `GITHUB_TOKEN` raises no
`issues` event, so the issue would appear and nothing would pick it up. The example
therefore dispatches `atomaton-runner.yml` explicitly. That is the same rule as everywhere
else in Atomaton — see
[GitHub raises no event for its own token](../how-it-works/github-raises-no-event-for-its-own-token.md).

**What it will cost.** One agent run per firing, whether or not there was anything to do,
except the firings the open-issue guard skips. Multiply your provider's per-run cost by
52 for a weekly schedule, 12 for a monthly one, and decide with that number in front of
you. If the answer is uncomfortable, the schedule is probably too frequent for the work —
which is the question this arrangement puts in front of you rather than hiding.

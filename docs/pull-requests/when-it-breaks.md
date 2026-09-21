# When a pull request will not merge

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Draft pull request will not merge | It is a draft, and the reviewer reports a `draft` blocker by design | The author marks it ready for review |
| Required check goes red and your CI never ran | The `.github/atomaton/` this pull request would merge cannot start a run, so validation returned `deliverable-invalid` and never dispatched CI — [what a pull request is checked against](boundaries.md#what-a-pull-request-is-checked-against) | Read the problems listed in the comment on the pull request; the engineer is dispatched to fix them, [as it is for failing CI](how-it-works.md#when-the-check-on-the-deliverable-fails). To reproduce it yourself first, [check your config before pushing it](../config/tasks/check-your-config-before-pushing-it.md) |

# When your config is wrong

**A key that is not a setting is read by nothing**, so a typo silently does
nothing. That is why the pull request that introduces one fails rather than
merging: the check reads `config.yaml` against the keys the code actually reads,
and reports a name that is in neither.

One level accepts names of your own. `chain.labels` takes more than the three
Atomaton reads, so a misspelling there is not caught by this — it produces a
label nobody applies.

The same check is runnable before you push:
[check your config before pushing it](tasks/check-your-config-before-pushing-it.md).

What that check looks at, and what it deliberately leaves to CI, is in
[what a pull request is checked against](../pull-requests/boundaries.md#what-a-pull-request-is-checked-against).

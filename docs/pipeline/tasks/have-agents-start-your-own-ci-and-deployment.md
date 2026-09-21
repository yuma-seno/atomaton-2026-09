# Have agents start your own CI and deployment

Most projects should not need this — it opts back out of the commands pipeline above.
Reach for it when the pipeline needs something commands cannot express.

```yaml
checks:
  your_workflow: ci.yml
deploy:
  your_workflow: deploy.yml
```

Name each file exactly as it is called, or the dispatch fails silently and every merge
is refused for a missing check. **Delete Atomaton's lists in the section you name a
workflow in.** The two are alternatives: declaring both fails the pull request's
check, naming the section and every list you left behind, rather than resolving by a
precedence rule.

Name `deploy.your_workflow` even when your deployment is already chained off CI or off a
push to the base branch. An agent merge is performed with `GITHUB_TOKEN`, and
[GitHub raises no event for its own token](../../work/how-it-works/github-raises-no-event-for-its-own-token.md),
so nothing downstream of that merge fires by itself and your deployment would
silently never run.

What each arm means, and what the workflow you name has to support, is in
[the pipeline reference](../reference.md#deployyour_workflow).

# Searching this repository's issues

`search__search_issues` answers a question from the issues and their discussion,
and returns which passage answered it — `matched_in: "comment 3"` — so the caller
can read that comment with `github__get_issue_comments(issue_number=..., from=3)`
rather than pulling a whole conversation in.

Nothing needs configuring for this to work. The index is built on the first
search, stored on the `atomaton-data` branch, and brought up to date on each
call by asking GitHub only for what changed.

**The question's language matters**, and it is the usual reason a search found
nothing. The first of [the two stages](how-the-issue-search-ranks.md) matches
characters rather than meaning, so a question asked in a language the issues are
not written in scores near zero and never reaches the cross encoder that does the
real ranking. Agents are told this in the tool's own description.

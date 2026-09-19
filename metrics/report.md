# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-19.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest | median round trips | median seconds each |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Last 7 days | 42 | 26.2% | 262 | 3,392 | 50 | 22.5 |
| Last 30 days | 42 | 26.2% | 262 | 3,392 | 50 | 22.5 |
| Last year | 42 | 26.2% | 262 | 3,392 | 50 | 22.5 |
| All time | 42 | 26.2% | 262 | 3,392 | 50 | 22.5 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 31 |
| `failed` | 8 |
| `stopped` | 2 |
| `runtime` | 1 |

## Last 7 days

25 sessions.

**62,010,263 tokens** over 29 runs that reported them, **97.3% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**93.3% of that prompt was served from cache**, over the 4 of 29 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 133,633 | 7,880,455 | 13,911,470 | 13,911,470 | 62,010,263 |
| messages per session | 113 | 541 | 1,598 | 1,598 | 6,727 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 16 | 64% |
| `reviewer` | 7 | 28% |
| `orchestrator` | 2 | 8% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,191 | 14 | 25 | 0.6% |
| `read` | 364 | 2 | 0 | 0.5% |
| `grep` | 329 | 7 | 0 | 2.1% |
| `edit` | 80 | 1 | 0 | 1.3% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `web__fetch` | 50 | 4 | 0 | 8% |
| `atoma_builtin__load_skill` | 44 | 2 | 0 | 4.5% |
| `search__search_code` | 44 | 0 | 0 | 0% |
| `search__search_issues` | 44 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `list` | 31 | 1 | 0 | 3.2% |
| `glob` | 29 | 1 | 0 | 3.4% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `write` | 21 | 0 | 0 | 0% |
| `github__get_issue` | 20 | 0 | 0 | 0% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__get_pr` | 16 | 1 | 0 | 6.3% |
| `github__search_code` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 14 | 2 | 0 | 14.3% |
| `github__create_pr` | 14 | 3 | 0 | 21.4% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 11 | 2 | 0 | 18.2% |
| `github__get_issue_comments` | 11 | 0 | 0 | 0% |
| `github__submit_pr_review` | 10 | 1 | 0 | 10% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 6 | 0 | 6 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__get_branch` | 6 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 6 | 1 | 0 | 16.7% |
| `github__sync_branch` | 6 | 1 | 0 | 16.7% |
| `github__get_check_runs` | 5 | 0 | 0 | 0% |
| `github__get_pr_diff` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 5 | 0 | 0 | 0% |
| `github__list_prs` | 3 | 1 | 0 | 33.3% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__list_issues` | 1 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,263 | 57.6% |
| `other` | 419 | 19.1% |
| `open` | 377 | 17.2% |
| `edit` | 67 | 3.1% |
| `verify` | 66 | 3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 15 | 34.9% |
| `engineering/tdd` | 9 | 20.9% |
| `delivery/implementation-handoff` | 7 | 16.3% |
| `review/quick-quality-gate` | 7 | 16.3% |
| `delivery/issue-decomposition` | 2 | 4.7% |
| `engineering/environment` | 2 | 4.7% |
| `engineering/nonexistent` | 1 | 2.3% |

## Last 30 days

25 sessions.

**74,913,816 tokens** over 76 runs that reported them, **97.5% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**93.3% of that prompt was served from cache**, over the 4 of 76 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 53,712 | 4,092,917 | 13,911,470 | 13,911,470 | 74,913,816 |
| messages per session | 113 | 541 | 1,598 | 1,598 | 6,727 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 16 | 64% |
| `reviewer` | 7 | 28% |
| `orchestrator` | 2 | 8% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,191 | 14 | 25 | 0.6% |
| `read` | 364 | 2 | 0 | 0.5% |
| `grep` | 329 | 7 | 0 | 2.1% |
| `edit` | 80 | 1 | 0 | 1.3% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `web__fetch` | 50 | 4 | 0 | 8% |
| `atoma_builtin__load_skill` | 44 | 2 | 0 | 4.5% |
| `search__search_code` | 44 | 0 | 0 | 0% |
| `search__search_issues` | 44 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `list` | 31 | 1 | 0 | 3.2% |
| `glob` | 29 | 1 | 0 | 3.4% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `write` | 21 | 0 | 0 | 0% |
| `github__get_issue` | 20 | 0 | 0 | 0% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__get_pr` | 16 | 1 | 0 | 6.3% |
| `github__search_code` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 14 | 2 | 0 | 14.3% |
| `github__create_pr` | 14 | 3 | 0 | 21.4% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 11 | 2 | 0 | 18.2% |
| `github__get_issue_comments` | 11 | 0 | 0 | 0% |
| `github__submit_pr_review` | 10 | 1 | 0 | 10% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 6 | 0 | 6 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__get_branch` | 6 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 6 | 1 | 0 | 16.7% |
| `github__sync_branch` | 6 | 1 | 0 | 16.7% |
| `github__get_check_runs` | 5 | 0 | 0 | 0% |
| `github__get_pr_diff` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 5 | 0 | 0 | 0% |
| `github__list_prs` | 3 | 1 | 0 | 33.3% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__list_issues` | 1 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,263 | 57.6% |
| `other` | 419 | 19.1% |
| `open` | 377 | 17.2% |
| `edit` | 67 | 3.1% |
| `verify` | 66 | 3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 15 | 34.9% |
| `engineering/tdd` | 9 | 20.9% |
| `delivery/implementation-handoff` | 7 | 16.3% |
| `review/quick-quality-gate` | 7 | 16.3% |
| `delivery/issue-decomposition` | 2 | 4.7% |
| `engineering/environment` | 2 | 4.7% |
| `engineering/nonexistent` | 1 | 2.3% |

## Last year

25 sessions.

**178,047,799 tokens** over 436 runs that reported them, **98.4% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**93.3% of that prompt was served from cache**, over the 4 of 436 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 26,356 | 351,468 | 9,000,677 | 39,737,697 | 178,047,799 |
| messages per session | 113 | 541 | 1,598 | 1,598 | 6,727 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 16 | 64% |
| `reviewer` | 7 | 28% |
| `orchestrator` | 2 | 8% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,191 | 14 | 25 | 0.6% |
| `read` | 364 | 2 | 0 | 0.5% |
| `grep` | 329 | 7 | 0 | 2.1% |
| `edit` | 80 | 1 | 0 | 1.3% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `web__fetch` | 50 | 4 | 0 | 8% |
| `atoma_builtin__load_skill` | 44 | 2 | 0 | 4.5% |
| `search__search_code` | 44 | 0 | 0 | 0% |
| `search__search_issues` | 44 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `list` | 31 | 1 | 0 | 3.2% |
| `glob` | 29 | 1 | 0 | 3.4% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `write` | 21 | 0 | 0 | 0% |
| `github__get_issue` | 20 | 0 | 0 | 0% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__get_pr` | 16 | 1 | 0 | 6.3% |
| `github__search_code` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 14 | 2 | 0 | 14.3% |
| `github__create_pr` | 14 | 3 | 0 | 21.4% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 11 | 2 | 0 | 18.2% |
| `github__get_issue_comments` | 11 | 0 | 0 | 0% |
| `github__submit_pr_review` | 10 | 1 | 0 | 10% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 6 | 0 | 6 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__get_branch` | 6 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 6 | 1 | 0 | 16.7% |
| `github__sync_branch` | 6 | 1 | 0 | 16.7% |
| `github__get_check_runs` | 5 | 0 | 0 | 0% |
| `github__get_pr_diff` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 5 | 0 | 0 | 0% |
| `github__list_prs` | 3 | 1 | 0 | 33.3% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__list_issues` | 1 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,263 | 57.6% |
| `other` | 419 | 19.1% |
| `open` | 377 | 17.2% |
| `edit` | 67 | 3.1% |
| `verify` | 66 | 3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 15 | 34.9% |
| `engineering/tdd` | 9 | 20.9% |
| `delivery/implementation-handoff` | 7 | 16.3% |
| `review/quick-quality-gate` | 7 | 16.3% |
| `delivery/issue-decomposition` | 2 | 4.7% |
| `engineering/environment` | 2 | 4.7% |
| `engineering/nonexistent` | 1 | 2.3% |

## All time

380 sessions.

**178,047,799 tokens** over 436 runs that reported them, **98.4% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**93.3% of that prompt was served from cache**, over the 4 of 436 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 26,356 | 351,468 | 9,000,677 | 39,737,697 | 178,047,799 |
| messages per session | 10 | 110 | 601 | 1,598 | 19,526 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 243 | 63.9% |
| `engineer` | 98 | 25.8% |
| `orchestrator` | 39 | 10.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 4,456 | 633 | 157 | 14.2% |
| `filesystem__read_text_file` | 593 | 43 | 24 | 7.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `read` | 364 | 2 | 0 | 0.5% |
| `filesystem_readonly__read_file` | 358 | 12 | 5 | 3.4% |
| `grep` | 329 | 7 | 0 | 2.1% |
| `filesystem__list_directory` | 264 | 6 | 0 | 2.3% |
| `github__check_merge_readiness` | 232 | 3 | 0 | 1.3% |
| `atoma_builtin__load_skill` | 213 | 77 | 0 | 36.2% |
| `github__get_issue` | 199 | 22 | 2 | 11.1% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `filesystem_readonly__list_directory` | 184 | 0 | 0 | 0% |
| `github__submit_pr_review` | 117 | 30 | 0 | 25.6% |
| `search__search_code` | 112 | 0 | 0 | 0% |
| `github__search_code` | 100 | 32 | 0 | 32% |
| `github__commit_and_push` | 98 | 54 | 0 | 55.1% |
| `github__get_pr` | 83 | 11 | 0 | 13.3% |
| `edit` | 80 | 1 | 0 | 1.3% |
| `web__fetch` | 79 | 5 | 0 | 6.3% |
| `search__search_issues` | 73 | 4 | 0 | 5.5% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `github__create_pr` | 65 | 27 | 0 | 41.5% |
| `filesystem__edit_file` | 63 | 6 | 0 | 9.5% |
| `filesystem_readonly__read_text_file` | 62 | 2 | 29 | 3.2% |
| `github__get_check_runs` | 58 | 6 | 0 | 10.3% |
| `filesystem__read_multiple_files` | 56 | 0 | 0 | 0% |
| `github__get_pr_diff` | 52 | 4 | 0 | 7.7% |
| `github__get_issue_comments` | 51 | 8 | 0 | 15.7% |
| `filesystem__search_files` | 50 | 0 | 43 | 0% |
| `github__create_issue` | 41 | 4 | 0 | 9.8% |
| `filesystem_readonly__search_files` | 38 | 1 | 21 | 2.6% |
| `github__close_issue` | 37 | 1 | 18 | 2.7% |
| `github__merge_pr` | 37 | 1 | 0 | 2.7% |
| `filesystem__read_file` | 35 | 0 | 1 | 0% |
| `github__get_branch` | 34 | 13 | 0 | 38.2% |
| `github__get_pr_reviews` | 34 | 2 | 0 | 5.9% |
| `github__list_issues` | 32 | 3 | 0 | 9.4% |
| `github__list_prs` | 32 | 1 | 0 | 3.1% |
| `list` | 31 | 1 | 0 | 3.2% |
| `glob` | 29 | 1 | 0 | 3.4% |
| `filesystem__directory_tree` | 26 | 0 | 26 | 0% |
| `shell__terminal_list` | 26 | 21 | 0 | 80.8% |
| `write` | 21 | 0 | 0 | 0% |
| `filesystem_readonly__directory_tree` | 20 | 0 | 20 | 0% |
| `filesystem__get_file_info` | 18 | 6 | 0 | 33.3% |
| `atoma__launch_sub_agent` | 17 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 17 | 0 | 0 | 0% |
| `filesystem__list_allowed_directories` | 14 | 0 | 0 | 0% |
| `filesystem_readonly__list_allowed_directories` | 14 | 0 | 14 | 0% |
| `github__sync_branch` | 14 | 8 | 0 | 57.1% |
| `shell__terminal_close` | 12 | 4 | 0 | 33.3% |
| `atoma__request_close_issue` | 11 | 1 | 0 | 9.1% |
| `shell__shell_set_default_workdir` | 11 | 2 | 0 | 18.2% |
| `github__list_pr_review_comments` | 5 | 0 | 0 | 0% |
| `shell__command_history_query` | 4 | 2 | 0 | 50% |
| `filesystem_readonly__edit_file` | 3 | 0 | 3 | 0% |
| `filesystem_readonly__write_file` | 3 | 0 | 3 | 0% |
| `shell__terminal_get_info` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__get_file_info` | 2 | 0 | 0 | 0% |
| `search_files` | 2 | 2 | 0 | 100% |
| `shell__execute` | 2 | 2 | 0 | 100% |
| `shell__list_execution_outputs` | 2 | 2 | 0 | 100% |
| `shell__process_get_execution` | 2 | 1 | 0 | 50% |
| `shell__read_execution_output` | 2 | 1 | 0 | 50% |
| `atomaton__launch_sub_agent` | 1 | 0 | 0 | 0% |
| `bun__run__synth__check__fix__the__dist__git__is__stale__with__the__source__changes` | 1 | 1 | 0 | 100% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `filesystem__delete_file` | 1 | 1 | 0 | 100% |
| `filesystem__move_file` | 1 | 0 | 0 | 0% |
| `filesystem__search_code` | 1 | 1 | 0 | 100% |
| `filesystem_readonly__list_directory_with_sizes` | 1 | 0 | 1 | 0% |
| `github__add_issue_comment` | 1 | 0 | 0 | 0% |
| `read_multiple_files` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell__ssh_execute` | 1 | 1 | 0 | 100% |
| `shell__terminals_terminal_operate` | 1 | 1 | 0 | 100% |
| `shell__write_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |
| `terminal_operate` | 1 | 1 | 0 | 100% |
| `web__search` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 2,070 | 46.4% |
| `other` | 1,405 | 31.5% |
| `open` | 636 | 14.3% |
| `verify` | 215 | 4.8% |
| `edit` | 131 | 2.9% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 41 | 29.9% |
| `project/conventions` | 37 | 27% |
| `delivery/implementation-handoff` | 25 | 18.2% |
| `engineering/tdd` | 14 | 10.2% |
| `delivery/issue-decomposition` | 10 | 7.3% |
| `engineering/environment` | 4 | 2.9% |
| `engineering/debugging` | 3 | 2.2% |
| `research/web-search` | 2 | 1.5% |
| `engineering/nonexistent` | 1 | 0.7% |

## Degraded answers

A tool can answer and report that it answered badly — a search that came back unranked, a log that went nowhere. The call succeeded, so it is neither a failure nor a refusal, and it is easy for one of these to run for months with nobody reading it. **Read `last seen` before `reports`**: an old count is a fixed fault. That date is when the session file was last written, which is the run that touched it last and not necessarily the run that reported the problem — so it errs recent.

| last seen | server | reports | sessions | problem |
| --- | --- | ---: | ---: | --- |
| 2026-09-19 | `github` | 1 | 1 | On a detached HEAD, `git branch` prints its own pseudo-entry for HEAD — `(HEAD detached at pull/N/head)` — and `--format |
| 2026-09-19 | `github` | 1 | 1 | - the reported failure reproduced — `refs/remotes/pull/N/head` checked out detached, `main` deleted so `git branch --poi |
| 2026-09-19 | `github` | 1 | 1 | Reverting only `resolveBranch()` to its previous body makes the four new `lib.test.ts` cases and both detached-HEAD MCP  |
| 2026-09-19 | `search` | 4 | 4 | could not preload the reranker (EACCES), results are first-stage ordered |
| 2026-09-19 | `github` | 3 | 2 | [atomaton-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the num |
| 2026-09-18 | `github` | 1 | 1 | **Does not install `tools.packages`.** The only entry is `@huggingface/transformers`, which `search.ts` imports lazily,  |
| 2026-09-18 | `github` | 1 | 1 | `✗ [files_readonly] allow/deny pattern 'reed' matches none of this server's tools (read, grep, glob, edit, write, list). |
| 2026-09-18 | `github` | 1 | 1 | `Error: MCP server 'web' did not start` / `error: Module not found …/mcp/webs.ts` → exit 1. |
| 2026-09-18 | `github` | 1 | 1 | [atomaton-github] Tool error for sync_branch: Cannot synchronize 'atomaton/issue-N' while 'detached HEAD' is checked out |
| 2026-09-18 | `github` | 1 | 1 | (2), or a definition that does not parse all warn and continue — "I could not ask" is |
| 2026-09-18 | `github` | 1 | 1 | - On refusal it prints the core's output and an `::error::` naming the secret to add, |
| 2026-09-18 | `github` | 1 | 1 | broken definition each warning and continuing. |
| 2026-09-18 | `github` | 1 | 1 | see, since the step degrades to a warning and would otherwise go silently inert. |
| 2026-09-14 | `github` | 6 | 3 | [ops-log] WARN: failed to write op log: Error: ENOENT: no such file or directory, open '${RUNNER_TEMP}/atoma-run/atoma_o |
| 2026-09-13 | `github` | 2 | 1 | [atoma-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the number |
| 2026-09-13 | `search` | 1 | 1 | [atoma-search] code query "what happens in the run loop when a tool call errors repeate" -> src/scripts/notify_limit_rea |
| 2026-09-13 | `search` | 1 | 1 | [atoma-search] code query "how does the runner handle a tool call that errors, does it " -> src/atoma/tools/scripts/mcp/ |
| 2026-09-13 | `shell` | 1 | 1 | [atoma-shell] exec: grep -n "error: \[atoma-search\]\\|error:\\|truncate\\|slice" src/atoma/tools/scripts/mcp/search.ts \| h |
| 2026-09-13 | `search` | 1 | 1 | [atoma-search] code query "when a tool call errors, does the loop retry the same call o" -> src/domain/pr-validation.tes |
| 2026-09-12 | `search` | 1 | 1 | could not preload the reranker (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge |
| 2026-09-12 | `search` | 1 | 1 | reranking failed (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge-reranker-v2-m |
| 2026-09-05 | `search` | 2 | 2 | reranking failed (EACCES); these results are first-stage ordered, not reranked |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Every declared server has been called at least once.

Skills never loaded:

- `delivery/pipeline-setup`

# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-21.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest | median round trips | median seconds each |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Last 7 days | 62 | 30.6% | 227 | 3,392 | 28 | 20.6 |
| Last 30 days | 68 | 29.4% | 178 | 3,392 | 28 | 20.6 |
| Last year | 68 | 29.4% | 178 | 3,392 | 28 | 20.6 |
| All time | 68 | 29.4% | 178 | 3,392 | 28 | 20.6 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 48 |
| `failed` | 8 |
| `stopped` | 8 |
| `runtime` | 4 |

## Last 7 days

35 sessions.

**71,619,009 tokens** over 34 runs that reported them, **96.8% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.6% of that prompt was served from cache**, over the 15 of 34 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 264,849 | 7,118,379 | 13,911,470 | 13,911,470 | 71,619,009 |
| messages per session | 168 | 532 | 1,598 | 1,598 | 8,732 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 20 | 57.1% |
| `reviewer` | 11 | 31.4% |
| `orchestrator` | 4 | 11.4% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,339 | 14 | 26 | 0.6% |
| `read` | 760 | 2 | 0 | 0.3% |
| `grep` | 691 | 11 | 0 | 1.6% |
| `web__fetch` | 168 | 12 | 0 | 7.1% |
| `edit` | 98 | 1 | 0 | 1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `list` | 75 | 1 | 0 | 1.3% |
| `glob` | 61 | 1 | 0 | 1.6% |
| `atoma_builtin__load_skill` | 58 | 0 | 0 | 0% |
| `github__get_issue` | 57 | 0 | 0 | 0% |
| `search__search_issues` | 57 | 0 | 0 | 0% |
| `search__search_code` | 48 | 0 | 0 | 0% |
| `github__get_issue_comments` | 34 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_pr` | 33 | 1 | 0 | 3% |
| `write` | 31 | 0 | 0 | 0% |
| `github__get_branch` | 25 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__search_code` | 22 | 2 | 0 | 9.1% |
| `github__create_pr` | 20 | 6 | 0 | 30% |
| `github__list_prs` | 18 | 1 | 0 | 5.6% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__check_merge_readiness` | 16 | 2 | 0 | 12.5% |
| `github__commit_and_push` | 15 | 1 | 0 | 6.7% |
| `github__get_check_runs` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_pr_diff` | 13 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 11 | 1 | 0 | 9.1% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__close_issue` | 8 | 0 | 7 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__merge_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `atomaton__request_close_issue` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,306 | 55.8% |
| `other` | 490 | 20.9% |
| `open` | 392 | 16.8% |
| `verify` | 79 | 3.4% |
| `edit` | 73 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 3 | 42.9% |
| `delivery/implementation-handoff` | 2 | 28.6% |
| `delivery/issue-decomposition` | 1 | 14.3% |
| `review/quick-quality-gate` | 1 | 14.3% |

## Last 30 days

40 sessions.

**83,477,060 tokens** over 53 runs that reported them, **97% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.6% of that prompt was served from cache**, over the 15 of 53 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 251,449 | 6,464,694 | 13,911,470 | 13,911,470 | 83,477,060 |
| messages per session | 118 | 532 | 1,598 | 1,598 | 8,773 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 25 | 62.5% |
| `reviewer` | 11 | 27.5% |
| `orchestrator` | 4 | 10% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,342 | 14 | 27 | 0.6% |
| `read` | 760 | 2 | 0 | 0.3% |
| `grep` | 691 | 11 | 0 | 1.6% |
| `web__fetch` | 168 | 12 | 0 | 7.1% |
| `edit` | 98 | 1 | 0 | 1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `list` | 75 | 1 | 0 | 1.3% |
| `atoma_builtin__load_skill` | 61 | 2 | 0 | 3.3% |
| `glob` | 61 | 1 | 0 | 1.6% |
| `search__search_issues` | 61 | 0 | 0 | 0% |
| `github__get_issue` | 57 | 0 | 0 | 0% |
| `search__search_code` | 48 | 0 | 0 | 0% |
| `github__get_issue_comments` | 34 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_pr` | 33 | 1 | 0 | 3% |
| `write` | 31 | 0 | 0 | 0% |
| `github__get_branch` | 25 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__search_code` | 22 | 2 | 0 | 9.1% |
| `github__create_pr` | 20 | 6 | 0 | 30% |
| `github__list_prs` | 18 | 1 | 0 | 5.6% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__check_merge_readiness` | 16 | 2 | 0 | 12.5% |
| `github__commit_and_push` | 16 | 2 | 0 | 12.5% |
| `github__get_check_runs` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_pr_diff` | 13 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 11 | 1 | 0 | 9.1% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__close_issue` | 8 | 0 | 7 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__merge_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `atomaton__request_close_issue` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,306 | 55.7% |
| `other` | 493 | 21% |
| `open` | 392 | 16.7% |
| `verify` | 79 | 3.4% |
| `edit` | 73 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 3 | 37.5% |
| `delivery/implementation-handoff` | 2 | 25% |
| `delivery/issue-decomposition` | 1 | 12.5% |
| `engineering/tdd` | 1 | 12.5% |
| `review/quick-quality-gate` | 1 | 12.5% |

## Last year

40 sessions.

**187,938,489 tokens** over 447 runs that reported them, **98.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.6% of that prompt was served from cache**, over the 15 of 447 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 27,107 | 382,963 | 9,000,677 | 39,737,697 | 187,938,489 |
| messages per session | 118 | 532 | 1,598 | 1,598 | 8,773 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 25 | 62.5% |
| `reviewer` | 11 | 27.5% |
| `orchestrator` | 4 | 10% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,342 | 14 | 27 | 0.6% |
| `read` | 760 | 2 | 0 | 0.3% |
| `grep` | 691 | 11 | 0 | 1.6% |
| `web__fetch` | 168 | 12 | 0 | 7.1% |
| `edit` | 98 | 1 | 0 | 1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `list` | 75 | 1 | 0 | 1.3% |
| `atoma_builtin__load_skill` | 61 | 2 | 0 | 3.3% |
| `glob` | 61 | 1 | 0 | 1.6% |
| `search__search_issues` | 61 | 0 | 0 | 0% |
| `github__get_issue` | 57 | 0 | 0 | 0% |
| `search__search_code` | 48 | 0 | 0 | 0% |
| `github__get_issue_comments` | 34 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_pr` | 33 | 1 | 0 | 3% |
| `write` | 31 | 0 | 0 | 0% |
| `github__get_branch` | 25 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__search_code` | 22 | 2 | 0 | 9.1% |
| `github__create_pr` | 20 | 6 | 0 | 30% |
| `github__list_prs` | 18 | 1 | 0 | 5.6% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__check_merge_readiness` | 16 | 2 | 0 | 12.5% |
| `github__commit_and_push` | 16 | 2 | 0 | 12.5% |
| `github__get_check_runs` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_pr_diff` | 13 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 11 | 1 | 0 | 9.1% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__close_issue` | 8 | 0 | 7 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__merge_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `atomaton__request_close_issue` | 1 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,306 | 55.7% |
| `other` | 493 | 21% |
| `open` | 392 | 16.7% |
| `verify` | 79 | 3.4% |
| `edit` | 73 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 3 | 37.5% |
| `delivery/implementation-handoff` | 2 | 25% |
| `delivery/issue-decomposition` | 1 | 12.5% |
| `engineering/tdd` | 1 | 12.5% |
| `review/quick-quality-gate` | 1 | 12.5% |

## All time

396 sessions.

**187,938,489 tokens** over 447 runs that reported them, **98.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.6% of that prompt was served from cache**, over the 15 of 447 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 27,107 | 382,963 | 9,000,677 | 39,737,697 | 187,938,489 |
| messages per session | 10 | 126 | 601 | 1,598 | 21,574 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 247 | 62.4% |
| `engineer` | 108 | 27.3% |
| `orchestrator` | 41 | 10.4% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 4,607 | 633 | 159 | 13.7% |
| `read` | 760 | 2 | 0 | 0.3% |
| `grep` | 691 | 11 | 0 | 1.6% |
| `filesystem__read_text_file` | 593 | 43 | 24 | 7.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem_readonly__read_file` | 358 | 12 | 5 | 3.4% |
| `filesystem__list_directory` | 264 | 6 | 0 | 2.3% |
| `github__check_merge_readiness` | 237 | 3 | 0 | 1.3% |
| `github__get_issue` | 236 | 22 | 2 | 9.3% |
| `atoma_builtin__load_skill` | 230 | 77 | 0 | 33.5% |
| `web__fetch` | 197 | 13 | 0 | 6.6% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `filesystem_readonly__list_directory` | 184 | 0 | 0 | 0% |
| `github__submit_pr_review` | 118 | 30 | 0 | 25.4% |
| `search__search_code` | 116 | 0 | 0 | 0% |
| `github__search_code` | 106 | 33 | 0 | 31.1% |
| `github__commit_and_push` | 100 | 54 | 0 | 54% |
| `github__get_pr` | 100 | 11 | 0 | 11% |
| `edit` | 98 | 1 | 0 | 1% |
| `search__search_issues` | 90 | 4 | 0 | 4.4% |
| `list` | 75 | 1 | 0 | 1.3% |
| `github__get_issue_comments` | 74 | 8 | 0 | 10.8% |
| `github__create_pr` | 71 | 30 | 0 | 42.3% |
| `github__get_check_runs` | 67 | 8 | 0 | 11.9% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `filesystem__edit_file` | 63 | 6 | 0 | 9.5% |
| `filesystem_readonly__read_text_file` | 62 | 2 | 29 | 3.2% |
| `glob` | 61 | 1 | 0 | 1.6% |
| `github__get_pr_diff` | 60 | 4 | 0 | 6.7% |
| `filesystem__read_multiple_files` | 56 | 0 | 0 | 0% |
| `github__get_branch` | 53 | 13 | 0 | 24.5% |
| `filesystem__search_files` | 50 | 0 | 43 | 0% |
| `github__list_prs` | 47 | 1 | 0 | 2.1% |
| `github__create_issue` | 41 | 4 | 0 | 9.8% |
| `github__close_issue` | 39 | 1 | 19 | 2.6% |
| `github__get_pr_reviews` | 39 | 2 | 0 | 5.1% |
| `github__merge_pr` | 39 | 1 | 0 | 2.6% |
| `filesystem_readonly__search_files` | 38 | 1 | 21 | 2.6% |
| `filesystem__read_file` | 35 | 0 | 1 | 0% |
| `github__list_issues` | 33 | 3 | 0 | 9.1% |
| `write` | 31 | 0 | 0 | 0% |
| `filesystem__directory_tree` | 26 | 0 | 26 | 0% |
| `shell__terminal_list` | 26 | 21 | 0 | 80.8% |
| `filesystem_readonly__directory_tree` | 20 | 0 | 20 | 0% |
| `filesystem__get_file_info` | 18 | 6 | 0 | 33.3% |
| `atoma__launch_sub_agent` | 17 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 17 | 0 | 0 | 0% |
| `github__sync_branch` | 16 | 8 | 0 | 50% |
| `filesystem__list_allowed_directories` | 14 | 0 | 0 | 0% |
| `filesystem_readonly__list_allowed_directories` | 14 | 0 | 14 | 0% |
| `shell__terminal_close` | 12 | 4 | 0 | 33.3% |
| `atoma__request_close_issue` | 11 | 1 | 0 | 9.1% |
| `shell__shell_set_default_workdir` | 11 | 2 | 0 | 18.2% |
| `github__list_pr_review_comments` | 7 | 0 | 0 | 0% |
| `shell__command_history_query` | 4 | 2 | 0 | 50% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__edit_file` | 3 | 0 | 3 | 0% |
| `filesystem_readonly__write_file` | 3 | 0 | 3 | 0% |
| `shell__terminal_get_info` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__get_file_info` | 2 | 0 | 0 | 0% |
| `search_files` | 2 | 2 | 0 | 100% |
| `shell__execute` | 2 | 2 | 0 | 100% |
| `shell__list_execution_outputs` | 2 | 2 | 0 | 100% |
| `shell__process_get_execution` | 2 | 1 | 0 | 50% |
| `shell__read_execution_output` | 2 | 1 | 0 | 50% |
| `atomaton__request_close_issue` | 1 | 0 | 0 | 0% |
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
| `search` | 2,113 | 45.9% |
| `other` | 1,479 | 32.1% |
| `open` | 651 | 14.1% |
| `verify` | 228 | 4.9% |
| `edit` | 137 | 3% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 61 | 89.7% |
| `project/conventions` | 3 | 4.4% |
| `delivery/implementation-handoff` | 2 | 2.9% |
| `delivery/issue-decomposition` | 1 | 1.5% |
| `engineering/tdd` | 1 | 1.5% |

## Degraded answers

A tool can answer and report that it answered badly — a search that came back unranked, a log that went nowhere. The call succeeded, so it is neither a failure nor a refusal, and it is easy for one of these to run for months with nobody reading it. **Read `last seen` before `reports`**: an old count is a fixed fault. That date is when the session file was last written, which is the run that touched it last and not necessarily the run that reported the problem — so it errs recent.

| last seen | server | reports | sessions | problem |
| --- | --- | ---: | ---: | --- |
| 2026-09-21 | `github` | 6 | 3 | [ops-log] WARN: failed to write op log: Error: ENOENT: no such file or directory, open '${RUNNER_TEMP}/atoma-run/atoma_o |
| 2026-09-21 | `search` | 4 | 4 | could not preload the reranker (EACCES), results are first-stage ordered |
| 2026-09-21 | `github` | 3 | 2 | [atomaton-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the num |
| 2026-09-21 | `search` | 2 | 2 | reranking failed (EACCES); these results are first-stage ordered, not reranked |
| 2026-09-21 | `github` | 2 | 1 | [atoma-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the number |
| 2026-09-21 | `search` | 1 | 1 | [atoma-search] code query "what happens in the run loop when a tool call errors repeate" -> src/scripts/notify_limit_rea |
| 2026-09-21 | `search` | 1 | 1 | [atoma-search] code query "how does the runner handle a tool call that errors, does it " -> src/atoma/tools/scripts/mcp/ |
| 2026-09-21 | `shell` | 1 | 1 | [atoma-shell] exec: grep -n "error: \[atoma-search\]\\|error:\\|truncate\\|slice" src/atoma/tools/scripts/mcp/search.ts \| h |
| 2026-09-21 | `search` | 1 | 1 | [atoma-search] code query "when a tool call errors, does the loop retry the same call o" -> src/domain/pr-validation.tes |
| 2026-09-21 | `search` | 1 | 1 | could not preload the reranker (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge |
| 2026-09-21 | `search` | 1 | 1 | reranking failed (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge-reranker-v2-m |
| 2026-09-21 | `github` | 1 | 1 | (2), or a definition that does not parse all warn and continue — "I could not ask" is |
| 2026-09-21 | `github` | 1 | 1 | - On refusal it prints the core's output and an `::error::` naming the secret to add, |
| 2026-09-21 | `github` | 1 | 1 | broken definition each warning and continuing. |
| 2026-09-21 | `github` | 1 | 1 | see, since the step degrades to a warning and would otherwise go silently inert. |
| 2026-09-21 | `github` | 1 | 1 | **Does not install `tools.packages`.** The only entry is `@huggingface/transformers`, which `search.ts` imports lazily,  |
| 2026-09-21 | `github` | 1 | 1 | `✗ [files_readonly] allow/deny pattern 'reed' matches none of this server's tools (read, grep, glob, edit, write, list). |
| 2026-09-21 | `github` | 1 | 1 | `Error: MCP server 'web' did not start` / `error: Module not found …/mcp/webs.ts` → exit 1. |
| 2026-09-21 | `github` | 1 | 1 | [atomaton-github] Tool error for sync_branch: Cannot synchronize 'atomaton/issue-N' while 'detached HEAD' is checked out |
| 2026-09-21 | `github` | 1 | 1 | [atomaton-github] Tool error for search_code: GitHub's code search quota is still exhausted after waiting Ns, so this se |
| 2026-09-21 | `github` | 1 | 1 | - **#N → PR #N** — `resolveBranch()` answers only with a real branch, and refuses in words rather than with `fatal: inva |
| 2026-09-21 | `github` | 1 | 1 | - `src/lib/lib.test.ts` — `resolveBranch()` in real repos, including one where `git branch --format=%(refname:short) --p |
| 2026-09-21 | `shell` | 1 | 1 | [atomaton-shell] exec: env -u ATOMATON_RUN_TYPE -u ISSUE_NUMBER -u ATOMATON_MACHINERY_ROOT bun test ./tests/contract/gen |
| 2026-09-21 | `github` | 1 | 1 | `commit_and_push` then built a refspec out of git's own description of the state and died on `fatal: invalid refspec '(H |
| 2026-09-21 | `github` | 1 | 1 | On a detached HEAD, `git branch` prints its own pseudo-entry for HEAD — `(HEAD detached at pull/N/head)` — and `--format |
| 2026-09-21 | `github` | 1 | 1 | - the reported failure reproduced — `refs/remotes/pull/N/head` checked out detached, `main` deleted so `git branch --poi |
| 2026-09-21 | `github` | 1 | 1 | Reverting only `resolveBranch()` to its previous body makes the four new `lib.test.ts` cases and both detached-HEAD MCP  |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Every declared server has been called at least once.

Skills never loaded:

- `delivery/pipeline-setup`
- `engineering/debugging`
- `engineering/environment`
- `research/web-search`

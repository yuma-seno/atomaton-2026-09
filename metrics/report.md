# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-19.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest | median round trips | median seconds each |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Last 7 days | 60 | 31.7% | 208 | 3,392 | 30 | 21.2 |
| Last 30 days | 61 | 31.1% | 178 | 3,392 | 30 | 21.2 |
| Last year | 61 | 31.1% | 178 | 3,392 | 30 | 21.2 |
| All time | 61 | 31.1% | 178 | 3,392 | 30 | 21.2 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 42 |
| `failed` | 8 |
| `stopped` | 7 |
| `runtime` | 4 |

## Last 7 days

35 sessions.

**71,040,762 tokens** over 34 runs that reported them, **96.8% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.9% of that prompt was served from cache**, over the 11 of 34 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 174,230 | 7,118,379 | 13,911,470 | 13,911,470 | 71,040,762 |
| messages per session | 118 | 532 | 1,598 | 1,598 | 8,330 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 22 | 62.9% |
| `reviewer` | 10 | 28.6% |
| `orchestrator` | 3 | 8.6% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,313 | 14 | 26 | 0.6% |
| `read` | 687 | 2 | 0 | 0.3% |
| `grep` | 608 | 11 | 0 | 1.8% |
| `web__fetch` | 157 | 12 | 0 | 7.6% |
| `edit` | 95 | 1 | 0 | 1.1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `search__search_issues` | 56 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 54 | 2 | 0 | 3.7% |
| `list` | 52 | 1 | 0 | 1.9% |
| `github__get_issue` | 51 | 0 | 0 | 0% |
| `glob` | 51 | 1 | 0 | 2% |
| `search__search_code` | 47 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_issue_comments` | 30 | 0 | 0 | 0% |
| `github__get_pr` | 30 | 1 | 0 | 3.3% |
| `write` | 29 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__get_branch` | 20 | 0 | 0 | 0% |
| `github__search_code` | 20 | 2 | 0 | 10% |
| `github__create_pr` | 18 | 5 | 0 | 27.8% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 15 | 2 | 0 | 13.3% |
| `github__check_merge_readiness` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_check_runs` | 13 | 2 | 0 | 15.4% |
| `github__list_prs` | 13 | 1 | 0 | 7.7% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `github__get_pr_reviews` | 10 | 1 | 0 | 10% |
| `github__get_pr_diff` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__close_issue` | 7 | 0 | 6 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__merge_pr` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,301 | 56.2% |
| `other` | 483 | 20.9% |
| `open` | 388 | 16.8% |
| `edit` | 71 | 3.1% |
| `verify` | 71 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 18 | 34% |
| `engineering/tdd` | 12 | 22.6% |
| `review/quick-quality-gate` | 10 | 18.9% |
| `delivery/implementation-handoff` | 7 | 13.2% |
| `delivery/issue-decomposition` | 3 | 5.7% |
| `engineering/environment` | 2 | 3.8% |
| `engineering/nonexistent` | 1 | 1.9% |

## Last 30 days

36 sessions.

**83,767,879 tokens** over 72 runs that reported them, **97.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.9% of that prompt was served from cache**, over the 11 of 72 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 68,832 | 5,399,337 | 13,911,470 | 13,911,470 | 83,767,879 |
| messages per session | 118 | 532 | 1,598 | 1,598 | 8,336 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 23 | 63.9% |
| `reviewer` | 10 | 27.8% |
| `orchestrator` | 3 | 8.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,313 | 14 | 26 | 0.6% |
| `read` | 687 | 2 | 0 | 0.3% |
| `grep` | 608 | 11 | 0 | 1.8% |
| `web__fetch` | 157 | 12 | 0 | 7.6% |
| `edit` | 95 | 1 | 0 | 1.1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `search__search_issues` | 57 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 54 | 2 | 0 | 3.7% |
| `list` | 52 | 1 | 0 | 1.9% |
| `github__get_issue` | 51 | 0 | 0 | 0% |
| `glob` | 51 | 1 | 0 | 2% |
| `search__search_code` | 47 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_issue_comments` | 30 | 0 | 0 | 0% |
| `github__get_pr` | 30 | 1 | 0 | 3.3% |
| `write` | 29 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__get_branch` | 20 | 0 | 0 | 0% |
| `github__search_code` | 20 | 2 | 0 | 10% |
| `github__create_pr` | 18 | 5 | 0 | 27.8% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 15 | 2 | 0 | 13.3% |
| `github__check_merge_readiness` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_check_runs` | 13 | 2 | 0 | 15.4% |
| `github__list_prs` | 13 | 1 | 0 | 7.7% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `github__get_pr_reviews` | 10 | 1 | 0 | 10% |
| `github__get_pr_diff` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__close_issue` | 7 | 0 | 6 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__merge_pr` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,301 | 56.2% |
| `other` | 483 | 20.9% |
| `open` | 388 | 16.8% |
| `edit` | 71 | 3.1% |
| `verify` | 71 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 18 | 34% |
| `engineering/tdd` | 12 | 22.6% |
| `review/quick-quality-gate` | 10 | 18.9% |
| `delivery/implementation-handoff` | 7 | 13.2% |
| `delivery/issue-decomposition` | 3 | 5.7% |
| `engineering/environment` | 2 | 3.8% |
| `engineering/nonexistent` | 1 | 1.9% |

## Last year

36 sessions.

**187,183,989 tokens** over 443 runs that reported them, **98.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.9% of that prompt was served from cache**, over the 11 of 443 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 26,784 | 382,963 | 9,000,677 | 39,737,697 | 187,183,989 |
| messages per session | 118 | 532 | 1,598 | 1,598 | 8,336 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 23 | 63.9% |
| `reviewer` | 10 | 27.8% |
| `orchestrator` | 3 | 8.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,313 | 14 | 26 | 0.6% |
| `read` | 687 | 2 | 0 | 0.3% |
| `grep` | 608 | 11 | 0 | 1.8% |
| `web__fetch` | 157 | 12 | 0 | 7.6% |
| `edit` | 95 | 1 | 0 | 1.1% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `search__search_issues` | 57 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 54 | 2 | 0 | 3.7% |
| `list` | 52 | 1 | 0 | 1.9% |
| `github__get_issue` | 51 | 0 | 0 | 0% |
| `glob` | 51 | 1 | 0 | 2% |
| `search__search_code` | 47 | 0 | 0 | 0% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `github__get_issue_comments` | 30 | 0 | 0 | 0% |
| `github__get_pr` | 30 | 1 | 0 | 3.3% |
| `write` | 29 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `github__get_branch` | 20 | 0 | 0 | 0% |
| `github__search_code` | 20 | 2 | 0 | 10% |
| `github__create_pr` | 18 | 5 | 0 | 27.8% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `github__commit_and_push` | 15 | 2 | 0 | 13.3% |
| `github__check_merge_readiness` | 14 | 2 | 0 | 14.3% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_check_runs` | 13 | 2 | 0 | 15.4% |
| `github__list_prs` | 13 | 1 | 0 | 7.7% |
| `github__submit_pr_review` | 11 | 1 | 0 | 9.1% |
| `github__get_pr_reviews` | 10 | 1 | 0 | 10% |
| `github__get_pr_diff` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__sync_branch` | 8 | 1 | 0 | 12.5% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `github__close_issue` | 7 | 0 | 6 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__create_issue` | 6 | 0 | 0 | 0% |
| `github__merge_pr` | 6 | 0 | 0 | 0% |
| `atomaton__launch_sub_agent` | 3 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 3 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__list_issues` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell_execute` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,301 | 56.2% |
| `other` | 483 | 20.9% |
| `open` | 388 | 16.8% |
| `edit` | 71 | 3.1% |
| `verify` | 71 | 3.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 18 | 34% |
| `engineering/tdd` | 12 | 22.6% |
| `review/quick-quality-gate` | 10 | 18.9% |
| `delivery/implementation-handoff` | 7 | 13.2% |
| `delivery/issue-decomposition` | 3 | 5.7% |
| `engineering/environment` | 2 | 3.8% |
| `engineering/nonexistent` | 1 | 1.9% |

## All time

392 sessions.

**187,183,989 tokens** over 443 runs that reported them, **98.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

**92.9% of that prompt was served from cache**, over the 11 of 443 runs whose provider reported it. A cached prompt token costs a fraction of a fresh one, so this is most of what separates the counts above from the bill — and it is the figure that moves when what gets resent changes.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 26,784 | 382,963 | 9,000,677 | 39,737,697 | 187,183,989 |
| messages per session | 10 | 117 | 601 | 1,598 | 21,137 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 246 | 62.8% |
| `engineer` | 106 | 27% |
| `orchestrator` | 40 | 10.2% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 4,578 | 633 | 158 | 13.8% |
| `read` | 687 | 2 | 0 | 0.3% |
| `grep` | 608 | 11 | 0 | 1.8% |
| `filesystem__read_text_file` | 593 | 43 | 24 | 7.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem_readonly__read_file` | 358 | 12 | 5 | 3.4% |
| `filesystem__list_directory` | 264 | 6 | 0 | 2.3% |
| `github__check_merge_readiness` | 235 | 3 | 0 | 1.3% |
| `github__get_issue` | 230 | 22 | 2 | 9.6% |
| `atoma_builtin__load_skill` | 223 | 77 | 0 | 34.5% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `web__fetch` | 186 | 13 | 0 | 7% |
| `filesystem_readonly__list_directory` | 184 | 0 | 0 | 0% |
| `github__submit_pr_review` | 118 | 30 | 0 | 25.4% |
| `search__search_code` | 115 | 0 | 0 | 0% |
| `github__search_code` | 104 | 33 | 0 | 31.7% |
| `github__commit_and_push` | 99 | 54 | 0 | 54.5% |
| `github__get_pr` | 97 | 11 | 0 | 11.3% |
| `edit` | 95 | 1 | 0 | 1.1% |
| `search__search_issues` | 86 | 4 | 0 | 4.7% |
| `github__get_issue_comments` | 70 | 8 | 0 | 11.4% |
| `github__create_pr` | 69 | 29 | 0 | 42% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `github__get_check_runs` | 66 | 8 | 0 | 12.1% |
| `filesystem__edit_file` | 63 | 6 | 0 | 9.5% |
| `filesystem_readonly__read_text_file` | 62 | 2 | 29 | 3.2% |
| `filesystem__read_multiple_files` | 56 | 0 | 0 | 0% |
| `github__get_pr_diff` | 56 | 4 | 0 | 7.1% |
| `list` | 52 | 1 | 0 | 1.9% |
| `glob` | 51 | 1 | 0 | 2% |
| `filesystem__search_files` | 50 | 0 | 43 | 0% |
| `github__get_branch` | 48 | 13 | 0 | 27.1% |
| `github__list_prs` | 42 | 1 | 0 | 2.4% |
| `github__create_issue` | 41 | 4 | 0 | 9.8% |
| `filesystem_readonly__search_files` | 38 | 1 | 21 | 2.6% |
| `github__close_issue` | 38 | 1 | 18 | 2.6% |
| `github__get_pr_reviews` | 38 | 2 | 0 | 5.3% |
| `github__merge_pr` | 38 | 1 | 0 | 2.6% |
| `filesystem__read_file` | 35 | 0 | 1 | 0% |
| `github__list_issues` | 33 | 3 | 0 | 9.1% |
| `write` | 29 | 0 | 0 | 0% |
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
| `search` | 2,108 | 46% |
| `other` | 1,469 | 32.1% |
| `open` | 647 | 14.1% |
| `verify` | 220 | 4.8% |
| `edit` | 135 | 2.9% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 44 | 29.9% |
| `project/conventions` | 40 | 27.2% |
| `delivery/implementation-handoff` | 25 | 17% |
| `engineering/tdd` | 17 | 11.6% |
| `delivery/issue-decomposition` | 11 | 7.5% |
| `engineering/environment` | 4 | 2.7% |
| `engineering/debugging` | 3 | 2% |
| `research/web-search` | 2 | 1.4% |
| `engineering/nonexistent` | 1 | 0.7% |

## Degraded answers

A tool can answer and report that it answered badly — a search that came back unranked, a log that went nowhere. The call succeeded, so it is neither a failure nor a refusal, and it is easy for one of these to run for months with nobody reading it. **Read `last seen` before `reports`**: an old count is a fixed fault. That date is when the session file was last written, which is the run that touched it last and not necessarily the run that reported the problem — so it errs recent.

| last seen | server | reports | sessions | problem |
| --- | --- | ---: | ---: | --- |
| 2026-09-19 | `github` | 6 | 3 | [ops-log] WARN: failed to write op log: Error: ENOENT: no such file or directory, open '${RUNNER_TEMP}/atoma-run/atoma_o |
| 2026-09-19 | `search` | 4 | 4 | could not preload the reranker (EACCES), results are first-stage ordered |
| 2026-09-19 | `github` | 3 | 2 | [atomaton-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the num |
| 2026-09-19 | `search` | 2 | 2 | reranking failed (EACCES); these results are first-stage ordered, not reranked |
| 2026-09-19 | `github` | 2 | 1 | [atoma-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the number |
| 2026-09-19 | `search` | 1 | 1 | [atoma-search] code query "what happens in the run loop when a tool call errors repeate" -> src/scripts/notify_limit_rea |
| 2026-09-19 | `search` | 1 | 1 | [atoma-search] code query "how does the runner handle a tool call that errors, does it " -> src/atoma/tools/scripts/mcp/ |
| 2026-09-19 | `shell` | 1 | 1 | [atoma-shell] exec: grep -n "error: \[atoma-search\]\\|error:\\|truncate\\|slice" src/atoma/tools/scripts/mcp/search.ts \| h |
| 2026-09-19 | `search` | 1 | 1 | [atoma-search] code query "when a tool call errors, does the loop retry the same call o" -> src/domain/pr-validation.tes |
| 2026-09-19 | `search` | 1 | 1 | could not preload the reranker (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge |
| 2026-09-19 | `search` | 1 | 1 | reranking failed (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge-reranker-v2-m |
| 2026-09-19 | `github` | 1 | 1 | (2), or a definition that does not parse all warn and continue — "I could not ask" is |
| 2026-09-19 | `github` | 1 | 1 | - On refusal it prints the core's output and an `::error::` naming the secret to add, |
| 2026-09-19 | `github` | 1 | 1 | broken definition each warning and continuing. |
| 2026-09-19 | `github` | 1 | 1 | see, since the step degrades to a warning and would otherwise go silently inert. |
| 2026-09-19 | `github` | 1 | 1 | **Does not install `tools.packages`.** The only entry is `@huggingface/transformers`, which `search.ts` imports lazily,  |
| 2026-09-19 | `github` | 1 | 1 | `✗ [files_readonly] allow/deny pattern 'reed' matches none of this server's tools (read, grep, glob, edit, write, list). |
| 2026-09-19 | `github` | 1 | 1 | `Error: MCP server 'web' did not start` / `error: Module not found …/mcp/webs.ts` → exit 1. |
| 2026-09-19 | `github` | 1 | 1 | [atomaton-github] Tool error for sync_branch: Cannot synchronize 'atomaton/issue-N' while 'detached HEAD' is checked out |
| 2026-09-19 | `github` | 1 | 1 | [atomaton-github] Tool error for search_code: GitHub's code search quota is still exhausted after waiting Ns, so this se |
| 2026-09-19 | `github` | 1 | 1 | - **#N → PR #N** — `resolveBranch()` answers only with a real branch, and refuses in words rather than with `fatal: inva |
| 2026-09-19 | `github` | 1 | 1 | - `src/lib/lib.test.ts` — `resolveBranch()` in real repos, including one where `git branch --format=%(refname:short) --p |
| 2026-09-19 | `shell` | 1 | 1 | [atomaton-shell] exec: env -u ATOMATON_RUN_TYPE -u ISSUE_NUMBER -u ATOMATON_MACHINERY_ROOT bun test ./tests/contract/gen |
| 2026-09-19 | `github` | 1 | 1 | `commit_and_push` then built a refspec out of git's own description of the state and died on `fatal: invalid refspec '(H |
| 2026-09-19 | `github` | 1 | 1 | On a detached HEAD, `git branch` prints its own pseudo-entry for HEAD — `(HEAD detached at pull/N/head)` — and `--format |
| 2026-09-19 | `github` | 1 | 1 | - the reported failure reproduced — `refs/remotes/pull/N/head` checked out detached, `main` deleted so `git branch --poi |
| 2026-09-19 | `github` | 1 | 1 | Reverting only `resolveBranch()` to its previous body makes the four new `lib.test.ts` cases and both detached-HEAD MCP  |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Every declared server has been called at least once.

Skills never loaded:

- `delivery/pipeline-setup`

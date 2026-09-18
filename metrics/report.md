# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-18.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest |
| --- | ---: | ---: | ---: | ---: |
| Last 7 days | 32 | 31.3% | 61 | 3,392 |
| Last 30 days | 32 | 31.3% | 61 | 3,392 |
| Last year | 32 | 31.3% | 61 | 3,392 |
| All time | 32 | 31.3% | 61 | 3,392 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 22 |
| `failed` | 8 |
| `runtime` | 1 |
| `stopped` | 1 |

## Last 7 days

19 sessions.

**28,378,150 tokens** over 24 runs that reported them, **98.4% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 102,241 | 5,399,337 | 13,911,470 | 13,911,470 | 28,378,150 |
| messages per session | 41 | 1,408 | 1,598 | 1,598 | 4,892 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 13 | 68.4% |
| `reviewer` | 5 | 26.3% |
| `orchestrator` | 1 | 5.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,951 | 10 | 20 | 0.5% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `read` | 53 | 0 | 0 | 0% |
| `search__search_code` | 41 | 0 | 0 | 0% |
| `grep` | 35 | 2 | 0 | 5.7% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `atoma_builtin__load_skill` | 29 | 2 | 0 | 6.9% |
| `search__search_issues` | 24 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `web__fetch` | 21 | 2 | 0 | 9.5% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `edit` | 13 | 0 | 0 | 0% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_issue` | 13 | 0 | 0 | 0% |
| `github__search_code` | 12 | 1 | 0 | 8.3% |
| `github__commit_and_push` | 10 | 1 | 0 | 10% |
| `github__get_pr` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__create_pr` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 6 | 1 | 0 | 16.7% |
| `github__get_issue_comments` | 6 | 0 | 0 | 0% |
| `glob` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 5 | 0 | 5 | 0% |
| `github__submit_pr_review` | 5 | 0 | 0 | 0% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 4 | 0 | 0 | 0% |
| `write` | 4 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__get_pr_diff` | 1 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 1 | 0 | 0 | 0% |
| `github__list_prs` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,238 | 63.5% |
| `open` | 366 | 18.8% |
| `other` | 247 | 12.7% |
| `verify` | 56 | 2.9% |
| `edit` | 44 | 2.3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 11 | 39.3% |
| `engineering/tdd` | 6 | 21.4% |
| `review/quick-quality-gate` | 5 | 17.9% |
| `delivery/implementation-handoff` | 4 | 14.3% |
| `delivery/issue-decomposition` | 1 | 3.6% |
| `engineering/nonexistent` | 1 | 3.6% |

## Last 30 days

19 sessions.

**42,622,778 tokens** over 93 runs that reported them, **98.3% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 35,135 | 438,539 | 13,911,470 | 13,911,470 | 42,622,778 |
| messages per session | 41 | 1,408 | 1,598 | 1,598 | 4,892 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 13 | 68.4% |
| `reviewer` | 5 | 26.3% |
| `orchestrator` | 1 | 5.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,951 | 10 | 20 | 0.5% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `read` | 53 | 0 | 0 | 0% |
| `search__search_code` | 41 | 0 | 0 | 0% |
| `grep` | 35 | 2 | 0 | 5.7% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `atoma_builtin__load_skill` | 29 | 2 | 0 | 6.9% |
| `search__search_issues` | 24 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `web__fetch` | 21 | 2 | 0 | 9.5% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `edit` | 13 | 0 | 0 | 0% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_issue` | 13 | 0 | 0 | 0% |
| `github__search_code` | 12 | 1 | 0 | 8.3% |
| `github__commit_and_push` | 10 | 1 | 0 | 10% |
| `github__get_pr` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__create_pr` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 6 | 1 | 0 | 16.7% |
| `github__get_issue_comments` | 6 | 0 | 0 | 0% |
| `glob` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 5 | 0 | 5 | 0% |
| `github__submit_pr_review` | 5 | 0 | 0 | 0% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 4 | 0 | 0 | 0% |
| `write` | 4 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__get_pr_diff` | 1 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 1 | 0 | 0 | 0% |
| `github__list_prs` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,238 | 63.5% |
| `open` | 366 | 18.8% |
| `other` | 247 | 12.7% |
| `verify` | 56 | 2.9% |
| `edit` | 44 | 2.3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 11 | 39.3% |
| `engineering/tdd` | 6 | 21.4% |
| `review/quick-quality-gate` | 5 | 17.9% |
| `delivery/implementation-handoff` | 4 | 14.3% |
| `delivery/issue-decomposition` | 1 | 3.6% |
| `engineering/nonexistent` | 1 | 3.6% |

## Last year

19 sessions.

**144,265,818 tokens** over 430 runs that reported them, **98.8% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 25,026 | 309,979 | 6,464,694 | 39,737,697 | 144,265,818 |
| messages per session | 41 | 1,408 | 1,598 | 1,598 | 4,892 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 13 | 68.4% |
| `reviewer` | 5 | 26.3% |
| `orchestrator` | 1 | 5.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,951 | 10 | 20 | 0.5% |
| `filesystem__read_text_file` | 77 | 1 | 0 | 1.3% |
| `read` | 53 | 0 | 0 | 0% |
| `search__search_code` | 41 | 0 | 0 | 0% |
| `grep` | 35 | 2 | 0 | 5.7% |
| `filesystem_readonly__read_text_file` | 33 | 2 | 0 | 6.1% |
| `atoma_builtin__load_skill` | 29 | 2 | 0 | 6.9% |
| `search__search_issues` | 24 | 0 | 0 | 0% |
| `filesystem__read_file` | 23 | 0 | 0 | 0% |
| `web__fetch` | 21 | 2 | 0 | 9.5% |
| `filesystem_readonly__search_files` | 17 | 1 | 0 | 5.9% |
| `filesystem__list_directory` | 16 | 1 | 0 | 6.3% |
| `edit` | 13 | 0 | 0 | 0% |
| `filesystem_readonly__list_directory` | 13 | 0 | 0 | 0% |
| `github__get_issue` | 13 | 0 | 0 | 0% |
| `github__search_code` | 12 | 1 | 0 | 8.3% |
| `github__commit_and_push` | 10 | 1 | 0 | 10% |
| `github__get_pr` | 9 | 0 | 0 | 0% |
| `filesystem__edit_file` | 8 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `github__create_pr` | 8 | 0 | 0 | 0% |
| `filesystem_readonly__read_file` | 7 | 1 | 0 | 14.3% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 6 | 1 | 0 | 16.7% |
| `github__get_issue_comments` | 6 | 0 | 0 | 0% |
| `glob` | 6 | 0 | 0 | 0% |
| `github__close_issue` | 5 | 0 | 5 | 0% |
| `github__submit_pr_review` | 5 | 0 | 0 | 0% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__merge_pr` | 4 | 0 | 0 | 0% |
| `write` | 4 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 2 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `github__get_pr_diff` | 1 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 1 | 0 | 0 | 0% |
| `github__list_prs` | 1 | 0 | 0 | 0% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,238 | 63.5% |
| `open` | 366 | 18.8% |
| `other` | 247 | 12.7% |
| `verify` | 56 | 2.9% |
| `edit` | 44 | 2.3% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 11 | 39.3% |
| `engineering/tdd` | 6 | 21.4% |
| `review/quick-quality-gate` | 5 | 17.9% |
| `delivery/implementation-handoff` | 4 | 14.3% |
| `delivery/issue-decomposition` | 1 | 3.6% |
| `engineering/nonexistent` | 1 | 3.6% |

## All time

374 sessions.

**144,265,818 tokens** over 430 runs that reported them, **98.8% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 25,026 | 309,979 | 6,464,694 | 39,737,697 | 144,265,818 |
| messages per session | 10 | 103 | 601 | 1,598 | 17,691 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 241 | 64.4% |
| `engineer` | 95 | 25.4% |
| `orchestrator` | 38 | 10.2% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 4,216 | 629 | 152 | 14.9% |
| `filesystem__read_text_file` | 593 | 43 | 24 | 7.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem_readonly__read_file` | 358 | 12 | 5 | 3.4% |
| `filesystem__list_directory` | 264 | 6 | 0 | 2.3% |
| `github__check_merge_readiness` | 227 | 2 | 0 | 0.9% |
| `atoma_builtin__load_skill` | 198 | 77 | 0 | 38.9% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `github__get_issue` | 192 | 22 | 2 | 11.5% |
| `filesystem_readonly__list_directory` | 184 | 0 | 0 | 0% |
| `github__submit_pr_review` | 112 | 29 | 0 | 25.9% |
| `search__search_code` | 109 | 0 | 0 | 0% |
| `github__search_code` | 96 | 32 | 0 | 33.3% |
| `github__commit_and_push` | 94 | 53 | 0 | 56.4% |
| `github__get_pr` | 76 | 10 | 0 | 13.2% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `filesystem__edit_file` | 63 | 6 | 0 | 9.5% |
| `filesystem_readonly__read_text_file` | 62 | 2 | 29 | 3.2% |
| `github__create_pr` | 59 | 24 | 0 | 40.7% |
| `filesystem__read_multiple_files` | 56 | 0 | 0 | 0% |
| `github__get_check_runs` | 55 | 6 | 0 | 10.9% |
| `read` | 53 | 0 | 0 | 0% |
| `search__search_issues` | 53 | 4 | 0 | 7.5% |
| `filesystem__search_files` | 50 | 0 | 43 | 0% |
| `web__fetch` | 50 | 3 | 0 | 6% |
| `github__get_pr_diff` | 48 | 4 | 0 | 8.3% |
| `github__get_issue_comments` | 46 | 8 | 0 | 17.4% |
| `filesystem_readonly__search_files` | 38 | 1 | 21 | 2.6% |
| `github__close_issue` | 36 | 1 | 17 | 2.8% |
| `github__merge_pr` | 36 | 1 | 0 | 2.8% |
| `filesystem__read_file` | 35 | 0 | 1 | 0% |
| `github__create_issue` | 35 | 4 | 0 | 11.4% |
| `grep` | 35 | 2 | 0 | 5.7% |
| `github__list_issues` | 31 | 3 | 0 | 9.7% |
| `github__get_branch` | 30 | 13 | 0 | 43.3% |
| `github__list_prs` | 30 | 0 | 0 | 0% |
| `github__get_pr_reviews` | 29 | 1 | 0 | 3.4% |
| `filesystem__directory_tree` | 26 | 0 | 26 | 0% |
| `shell__terminal_list` | 26 | 21 | 0 | 80.8% |
| `filesystem_readonly__directory_tree` | 20 | 0 | 20 | 0% |
| `filesystem__get_file_info` | 18 | 6 | 0 | 33.3% |
| `atoma__launch_sub_agent` | 17 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 17 | 0 | 0 | 0% |
| `filesystem__list_allowed_directories` | 14 | 0 | 0 | 0% |
| `filesystem_readonly__list_allowed_directories` | 14 | 0 | 14 | 0% |
| `edit` | 13 | 0 | 0 | 0% |
| `github__sync_branch` | 13 | 7 | 0 | 53.8% |
| `shell__terminal_close` | 12 | 4 | 0 | 33.3% |
| `atoma__request_close_issue` | 11 | 1 | 0 | 9.1% |
| `shell__shell_set_default_workdir` | 11 | 2 | 0 | 18.2% |
| `glob` | 6 | 0 | 0 | 0% |
| `github__list_pr_review_comments` | 4 | 0 | 0 | 0% |
| `shell__command_history_query` | 4 | 2 | 0 | 50% |
| `write` | 4 | 0 | 0 | 0% |
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
| `terminal_operate` | 1 | 1 | 0 | 100% |
| `web__search` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 2,045 | 48.5% |
| `other` | 1,233 | 29.2% |
| `open` | 625 | 14.8% |
| `verify` | 205 | 4.9% |
| `edit` | 108 | 2.6% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 39 | 32% |
| `project/conventions` | 33 | 27% |
| `delivery/implementation-handoff` | 22 | 18% |
| `engineering/tdd` | 11 | 9% |
| `delivery/issue-decomposition` | 9 | 7.4% |
| `engineering/debugging` | 3 | 2.5% |
| `engineering/environment` | 2 | 1.6% |
| `research/web-search` | 2 | 1.6% |
| `engineering/nonexistent` | 1 | 0.8% |

## Degraded answers

A tool can answer and report that it answered badly — a search that came back unranked, a log that went nowhere. The call succeeded, so it is neither a failure nor a refusal, and it is easy for one of these to run for months with nobody reading it. **Read `last seen` before `reports`**: an old count is a fixed fault. That date is when the session file was last written, which is the run that touched it last and not necessarily the run that reported the problem — so it errs recent.

| last seen | server | reports | sessions | problem |
| --- | --- | ---: | ---: | --- |
| 2026-09-18 | `github` | 6 | 3 | [ops-log] WARN: failed to write op log: Error: ENOENT: no such file or directory, open '${RUNNER_TEMP}/atoma-run/atoma_o |
| 2026-09-18 | `search` | 2 | 2 | reranking failed (EACCES); these results are first-stage ordered, not reranked |
| 2026-09-18 | `github` | 2 | 1 | [atoma-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the number |
| 2026-09-18 | `search` | 2 | 2 | could not preload the reranker (EACCES), results are first-stage ordered |
| 2026-09-18 | `search` | 1 | 1 | [atoma-search] code query "what happens in the run loop when a tool call errors repeate" -> src/scripts/notify_limit_rea |
| 2026-09-18 | `search` | 1 | 1 | [atoma-search] code query "how does the runner handle a tool call that errors, does it " -> src/atoma/tools/scripts/mcp/ |
| 2026-09-18 | `shell` | 1 | 1 | [atoma-shell] exec: grep -n "error: \[atoma-search\]\\|error:\\|truncate\\|slice" src/atoma/tools/scripts/mcp/search.ts \| h |
| 2026-09-18 | `search` | 1 | 1 | [atoma-search] code query "when a tool call errors, does the loop retry the same call o" -> src/domain/pr-validation.tes |
| 2026-09-18 | `search` | 1 | 1 | could not preload the reranker (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge |
| 2026-09-18 | `search` | 1 | 1 | reranking failed (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge-reranker-v2-m |
| 2026-09-18 | `github` | 1 | 1 | [atomaton-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the num |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Every declared server has been called at least once.

Skills never loaded:

- `delivery/pipeline-setup`

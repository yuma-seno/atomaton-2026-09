# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-14.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest |
| --- | ---: | ---: | ---: | ---: |
| Last 7 days | 8 | 12.5% | 55 | 499 |
| Last 30 days | 8 | 12.5% | 55 | 499 |
| Last year | 8 | 12.5% | 55 | 499 |
| All time | 8 | 12.5% | 55 | 499 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 7 |
| `failed` | 1 |

## Last 7 days

7 sessions.

**9,057,878 tokens** over 16 runs that reported them, **98.8% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 78,253 | 877,552 | 6,403,430 | 6,403,430 | 9,057,878 |
| messages per session | 10 | 354 | 354 | 354 | 410 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 6 | 85.7% |
| `reviewer` | 1 | 14.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 164 | 1 | 18 | 0.6% |
| `atoma_builtin__load_skill` | 6 | 2 | 0 | 33.3% |
| `filesystem__read_text_file` | 5 | 0 | 0 | 0% |
| `filesystem__edit_file` | 4 | 0 | 0 | 0% |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `filesystem__search_files` | 3 | 0 | 0 | 0% |
| `github__commit_and_push` | 2 | 1 | 0 | 50% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `filesystem__list_directory` | 1 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 1 | 1 | 0 | 100% |
| `github__create_pr` | 1 | 0 | 0 | 0% |
| `github__get_issue` | 1 | 0 | 0 | 0% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 70 | 42.7% |
| `search` | 43 | 26.2% |
| `open` | 24 | 14.6% |
| `verify` | 17 | 10.4% |
| `edit` | 10 | 6.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/tdd` | 2 | 40% |
| `engineering/nonexistent` | 1 | 20% |
| `project/conventions` | 1 | 20% |
| `review/quick-quality-gate` | 1 | 20% |

## Last 30 days

7 sessions.

**28,099,087 tokens** over 212 runs that reported them, **97.6% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 21,618 | 116,634 | 2,281,321 | 6,403,430 | 28,099,087 |
| messages per session | 10 | 354 | 354 | 354 | 410 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 6 | 85.7% |
| `reviewer` | 1 | 14.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 164 | 1 | 18 | 0.6% |
| `atoma_builtin__load_skill` | 6 | 2 | 0 | 33.3% |
| `filesystem__read_text_file` | 5 | 0 | 0 | 0% |
| `filesystem__edit_file` | 4 | 0 | 0 | 0% |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `filesystem__search_files` | 3 | 0 | 0 | 0% |
| `github__commit_and_push` | 2 | 1 | 0 | 50% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `filesystem__list_directory` | 1 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 1 | 1 | 0 | 100% |
| `github__create_pr` | 1 | 0 | 0 | 0% |
| `github__get_issue` | 1 | 0 | 0 | 0% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 70 | 42.7% |
| `search` | 43 | 26.2% |
| `open` | 24 | 14.6% |
| `verify` | 17 | 10.4% |
| `edit` | 10 | 6.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/tdd` | 2 | 40% |
| `engineering/nonexistent` | 1 | 20% |
| `project/conventions` | 1 | 20% |
| `review/quick-quality-gate` | 1 | 20% |

## Last year

7 sessions.

**116,374,840 tokens** over 415 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,374,840 |
| messages per session | 10 | 354 | 354 | 354 | 410 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 6 | 85.7% |
| `reviewer` | 1 | 14.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 164 | 1 | 18 | 0.6% |
| `atoma_builtin__load_skill` | 6 | 2 | 0 | 33.3% |
| `filesystem__read_text_file` | 5 | 0 | 0 | 0% |
| `filesystem__edit_file` | 4 | 0 | 0 | 0% |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `filesystem__search_files` | 3 | 0 | 0 | 0% |
| `github__commit_and_push` | 2 | 1 | 0 | 50% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `filesystem__list_directory` | 1 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 1 | 1 | 0 | 100% |
| `github__create_pr` | 1 | 0 | 0 | 0% |
| `github__get_issue` | 1 | 0 | 0 | 0% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 70 | 42.7% |
| `search` | 43 | 26.2% |
| `open` | 24 | 14.6% |
| `verify` | 17 | 10.4% |
| `edit` | 10 | 6.1% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/tdd` | 2 | 40% |
| `engineering/nonexistent` | 1 | 20% |
| `project/conventions` | 1 | 20% |
| `review/quick-quality-gate` | 1 | 20% |

## All time

362 sessions.

**116,374,840 tokens** over 415 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,374,840 |
| messages per session | 10 | 90 | 433 | 1,011 | 13,209 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 237 | 65.5% |
| `engineer` | 88 | 24.3% |
| `orchestrator` | 37 | 10.2% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,429 | 620 | 150 | 25.5% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem__read_text_file` | 521 | 42 | 24 | 8.1% |
| `filesystem_readonly__read_file` | 351 | 11 | 5 | 3.1% |
| `filesystem__list_directory` | 249 | 5 | 0 | 2% |
| `github__check_merge_readiness` | 222 | 2 | 0 | 0.9% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `github__get_issue` | 180 | 22 | 2 | 12.2% |
| `atoma_builtin__load_skill` | 175 | 77 | 0 | 44% |
| `filesystem_readonly__list_directory` | 171 | 0 | 0 | 0% |
| `github__submit_pr_review` | 107 | 29 | 0 | 27.1% |
| `github__commit_and_push` | 86 | 53 | 0 | 61.6% |
| `github__search_code` | 84 | 31 | 0 | 36.9% |
| `search__search_code` | 68 | 0 | 0 | 0% |
| `github__get_pr` | 67 | 10 | 0 | 14.9% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `filesystem__edit_file` | 59 | 6 | 0 | 10.2% |
| `github__get_check_runs` | 53 | 6 | 0 | 11.3% |
| `github__create_pr` | 52 | 24 | 0 | 46.2% |
| `filesystem__read_multiple_files` | 48 | 0 | 0 | 0% |
| `filesystem__search_files` | 47 | 0 | 43 | 0% |
| `github__get_pr_diff` | 47 | 4 | 0 | 8.5% |
| `github__get_issue_comments` | 40 | 8 | 0 | 20% |
| `github__create_issue` | 35 | 4 | 0 | 11.4% |
| `search__search_issues` | 33 | 4 | 0 | 12.1% |
| `github__merge_pr` | 32 | 1 | 0 | 3.1% |
| `github__close_issue` | 31 | 1 | 12 | 3.2% |
| `github__list_issues` | 31 | 3 | 0 | 9.7% |
| `filesystem_readonly__read_text_file` | 29 | 0 | 29 | 0% |
| `github__list_prs` | 29 | 0 | 0 | 0% |
| `web__fetch` | 29 | 1 | 0 | 3.4% |
| `github__get_branch` | 28 | 13 | 0 | 46.4% |
| `github__get_pr_reviews` | 28 | 1 | 0 | 3.6% |
| `filesystem__directory_tree` | 26 | 0 | 26 | 0% |
| `shell__terminal_list` | 26 | 21 | 0 | 80.8% |
| `filesystem_readonly__search_files` | 21 | 0 | 21 | 0% |
| `filesystem_readonly__directory_tree` | 20 | 0 | 20 | 0% |
| `filesystem__get_file_info` | 18 | 6 | 0 | 33.3% |
| `atoma__launch_sub_agent` | 17 | 0 | 0 | 0% |
| `filesystem_readonly__read_multiple_files` | 15 | 0 | 0 | 0% |
| `filesystem__list_allowed_directories` | 14 | 0 | 0 | 0% |
| `filesystem_readonly__list_allowed_directories` | 14 | 0 | 14 | 0% |
| `filesystem__read_file` | 12 | 0 | 1 | 0% |
| `shell__terminal_close` | 12 | 4 | 0 | 33.3% |
| `atoma__request_close_issue` | 11 | 1 | 0 | 9.1% |
| `shell__shell_set_default_workdir` | 11 | 2 | 0 | 18.2% |
| `github__sync_branch` | 8 | 7 | 0 | 87.5% |
| `github__list_pr_review_comments` | 4 | 0 | 0 | 0% |
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
| `bun__run__synth__check__fix__the__dist__git__is__stale__with__the__source__changes` | 1 | 1 | 0 | 100% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `filesystem__delete_file` | 1 | 1 | 0 | 100% |
| `filesystem__move_file` | 1 | 0 | 0 | 0% |
| `filesystem__search_code` | 1 | 1 | 0 | 100% |
| `filesystem_readonly__list_directory_with_sizes` | 1 | 0 | 1 | 0% |
| `github__add_issue_comment` | 1 | 0 | 0 | 0% |
| `read_multiple_files` | 1 | 1 | 0 | 100% |
| `shell__ssh_execute` | 1 | 1 | 0 | 100% |
| `shell__terminals_terminal_operate` | 1 | 1 | 0 | 100% |
| `shell__write_file` | 1 | 1 | 0 | 100% |
| `terminal_operate` | 1 | 1 | 0 | 100% |
| `web__search` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 1,056 | 43.5% |
| `search` | 850 | 35% |
| `open` | 283 | 11.7% |
| `verify` | 166 | 6.8% |
| `edit` | 74 | 3% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 35 | 35.4% |
| `project/conventions` | 23 | 23.2% |
| `delivery/implementation-handoff` | 18 | 18.2% |
| `delivery/issue-decomposition` | 8 | 8.1% |
| `engineering/tdd` | 7 | 7.1% |
| `engineering/debugging` | 3 | 3% |
| `engineering/environment` | 2 | 2% |
| `research/web-search` | 2 | 2% |
| `engineering/nonexistent` | 1 | 1% |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Servers never called:

- `atoma_env`

Every skill has been loaded at least once.

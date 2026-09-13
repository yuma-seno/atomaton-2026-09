# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-13.

## Runs

| window | runs | gave up | median seconds | longest |
| --- | ---: | ---: | ---: | ---: |
| Last 7 days | 5 | 0% | 55 | 73 |
| Last 30 days | 5 | 0% | 55 | 73 |
| Last year | 5 | 0% | 55 | 73 |
| All time | 5 | 0% | 55 | 73 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 5 |

## Last 7 days

5 sessions.

**116,319,480 tokens** over 413 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,319,480 |
| messages per session | 6 | 13 | 13 | 13 | 41 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 5 | 100% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 3 | 2 | 0 | 66.7% |
| `shell__shell_execute` | 3 | 0 | 1 | 0% |
| `github__commit_and_push` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 3 | 100% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/nonexistent` | 1 | 50% |
| `engineering/tdd` | 1 | 50% |

## Last 30 days

5 sessions.

**116,319,480 tokens** over 413 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,319,480 |
| messages per session | 6 | 13 | 13 | 13 | 41 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 5 | 100% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 3 | 2 | 0 | 66.7% |
| `shell__shell_execute` | 3 | 0 | 1 | 0% |
| `github__commit_and_push` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 3 | 100% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/nonexistent` | 1 | 50% |
| `engineering/tdd` | 1 | 50% |

## Last year

5 sessions.

**116,319,480 tokens** over 413 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,319,480 |
| messages per session | 6 | 13 | 13 | 13 | 41 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 5 | 100% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `search__search_issues` | 4 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 3 | 2 | 0 | 66.7% |
| `shell__shell_execute` | 3 | 0 | 1 | 0% |
| `github__commit_and_push` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `other` | 3 | 100% |

| skill | loads | share |
| --- | ---: | ---: |
| `engineering/nonexistent` | 1 | 50% |
| `engineering/tdd` | 1 | 50% |

## All time

360 sessions.

**116,319,480 tokens** over 413 runs that reported them, **98.9% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,584 | 270,394 | 5,198,798 | 39,737,697 | 116,319,480 |
| messages per session | 10 | 90 | 433 | 1,011 | 12,840 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 236 | 65.6% |
| `engineer` | 87 | 24.2% |
| `orchestrator` | 37 | 10.3% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 2,268 | 619 | 133 | 27.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem__read_text_file` | 516 | 42 | 24 | 8.1% |
| `filesystem_readonly__read_file` | 351 | 11 | 5 | 3.1% |
| `filesystem__list_directory` | 248 | 5 | 0 | 2% |
| `github__check_merge_readiness` | 221 | 1 | 0 | 0.5% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `github__get_issue` | 179 | 22 | 2 | 12.3% |
| `atoma_builtin__load_skill` | 172 | 77 | 0 | 44.8% |
| `filesystem_readonly__list_directory` | 171 | 0 | 0 | 0% |
| `github__submit_pr_review` | 107 | 29 | 0 | 27.1% |
| `github__commit_and_push` | 85 | 53 | 0 | 62.4% |
| `github__search_code` | 84 | 31 | 0 | 36.9% |
| `search__search_code` | 68 | 0 | 0 | 0% |
| `github__get_pr` | 67 | 10 | 0 | 14.9% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `filesystem__edit_file` | 55 | 6 | 0 | 10.9% |
| `github__get_check_runs` | 53 | 6 | 0 | 11.3% |
| `github__create_pr` | 51 | 24 | 0 | 47.1% |
| `filesystem__read_multiple_files` | 48 | 0 | 0 | 0% |
| `github__get_pr_diff` | 47 | 4 | 0 | 8.5% |
| `filesystem__search_files` | 44 | 0 | 43 | 0% |
| `github__get_issue_comments` | 40 | 8 | 0 | 20% |
| `github__create_issue` | 35 | 4 | 0 | 11.4% |
| `search__search_issues` | 33 | 4 | 0 | 12.1% |
| `github__merge_pr` | 32 | 1 | 0 | 3.1% |
| `github__close_issue` | 31 | 13 | 0 | 41.9% |
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
| `other` | 989 | 43.6% |
| `search` | 807 | 35.6% |
| `open` | 259 | 11.4% |
| `verify` | 149 | 6.6% |
| `edit` | 64 | 2.8% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 34 | 35.4% |
| `project/conventions` | 22 | 22.9% |
| `delivery/implementation-handoff` | 18 | 18.8% |
| `delivery/issue-decomposition` | 8 | 8.3% |
| `engineering/tdd` | 6 | 6.3% |
| `engineering/debugging` | 3 | 3.1% |
| `engineering/environment` | 2 | 2.1% |
| `research/web-search` | 2 | 2.1% |
| `engineering/nonexistent` | 1 | 1% |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Servers never called:

- `atoma_env`

Every skill has been loaded at least once.

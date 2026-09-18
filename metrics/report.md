# Agent metrics

Read from the sessions stored on this branch. Nothing here is recorded specially: every number is something the agents already wrote down while working.

Generated 2026-09-18.

A session appears in a dated window only if it recorded when its runs ended. Sessions from before run recording existed are counted under All time alone, so the dated windows are thinner than the project was — that gap closes as new sessions arrive, not by anything changing here.

## Runs

| window | runs | gave up | median seconds | longest |
| --- | ---: | ---: | ---: | ---: |
| Last 7 days | 25 | 24% | 37 | 2,481 |
| Last 30 days | 25 | 24% | 37 | 2,481 |
| Last year | 25 | 24% | 37 | 2,481 |
| All time | 25 | 24% | 37 | 2,481 |

**Gave up** is every ending that is not `completed` — a ceiling reached, a person asking, a provider hanging up, a loop cut short. Each one is a mechanism deciding the run should not continue, which is worth watching whether or not it was right.

| ended because | runs |
| --- | ---: |
| `completed` | 19 |
| `failed` | 6 |

## Last 7 days

14 sessions.

**21,388,537 tokens** over 21 runs that reported them, **99.7% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 68,832 | 438,539 | 13,911,470 | 13,911,470 | 21,388,537 |
| messages per session | 17 | 1,408 | 1,598 | 1,598 | 4,131 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 10 | 71.4% |
| `reviewer` | 4 | 28.6% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,816 | 8 | 19 | 0.4% |
| `filesystem__read_text_file` | 76 | 1 | 0 | 1.3% |
| `search__search_code` | 32 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 19 | 2 | 0 | 10.5% |
| `filesystem__list_directory` | 13 | 1 | 0 | 7.7% |
| `search__search_issues` | 10 | 0 | 0 | 0% |
| `github__commit_and_push` | 9 | 1 | 0 | 11.1% |
| `github__get_issue` | 9 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem__edit_file` | 7 | 0 | 0 | 0% |
| `github__create_pr` | 7 | 0 | 0 | 0% |
| `github__get_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 5 | 1 | 0 | 20% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__close_issue` | 4 | 0 | 4 | 0% |
| `github__submit_pr_review` | 4 | 0 | 0 | 0% |
| `github__get_issue_comments` | 3 | 0 | 0 | 0% |
| `github__merge_pr` | 3 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,229 | 67.7% |
| `open` | 349 | 19.2% |
| `other` | 164 | 9% |
| `verify` | 49 | 2.7% |
| `edit` | 25 | 1.4% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 6 | 33.3% |
| `engineering/tdd` | 4 | 22.2% |
| `review/quick-quality-gate` | 4 | 22.2% |
| `delivery/implementation-handoff` | 3 | 16.7% |
| `engineering/nonexistent` | 1 | 5.6% |

## Last 30 days

14 sessions.

**36,884,826 tokens** over 114 runs that reported them, **98.5% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 32,592 | 365,748 | 6,403,430 | 13,911,470 | 36,884,826 |
| messages per session | 17 | 1,408 | 1,598 | 1,598 | 4,131 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 10 | 71.4% |
| `reviewer` | 4 | 28.6% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,816 | 8 | 19 | 0.4% |
| `filesystem__read_text_file` | 76 | 1 | 0 | 1.3% |
| `search__search_code` | 32 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 19 | 2 | 0 | 10.5% |
| `filesystem__list_directory` | 13 | 1 | 0 | 7.7% |
| `search__search_issues` | 10 | 0 | 0 | 0% |
| `github__commit_and_push` | 9 | 1 | 0 | 11.1% |
| `github__get_issue` | 9 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem__edit_file` | 7 | 0 | 0 | 0% |
| `github__create_pr` | 7 | 0 | 0 | 0% |
| `github__get_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 5 | 1 | 0 | 20% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__close_issue` | 4 | 0 | 4 | 0% |
| `github__submit_pr_review` | 4 | 0 | 0 | 0% |
| `github__get_issue_comments` | 3 | 0 | 0 | 0% |
| `github__merge_pr` | 3 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,229 | 67.7% |
| `open` | 349 | 19.2% |
| `other` | 164 | 9% |
| `verify` | 49 | 2.7% |
| `edit` | 25 | 1.4% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 6 | 33.3% |
| `engineering/tdd` | 4 | 22.2% |
| `review/quick-quality-gate` | 4 | 22.2% |
| `delivery/implementation-handoff` | 3 | 16.7% |
| `engineering/nonexistent` | 1 | 5.6% |

## Last year

14 sessions.

**137,276,205 tokens** over 427 runs that reported them, **99.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,639 | 302,887 | 6,403,430 | 39,737,697 | 137,276,205 |
| messages per session | 17 | 1,408 | 1,598 | 1,598 | 4,131 |

| agent | sessions | share |
| --- | ---: | ---: |
| `engineer` | 10 | 71.4% |
| `reviewer` | 4 | 28.6% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 1,816 | 8 | 19 | 0.4% |
| `filesystem__read_text_file` | 76 | 1 | 0 | 1.3% |
| `search__search_code` | 32 | 0 | 0 | 0% |
| `atoma_builtin__load_skill` | 19 | 2 | 0 | 10.5% |
| `filesystem__list_directory` | 13 | 1 | 0 | 7.7% |
| `search__search_issues` | 10 | 0 | 0 | 0% |
| `github__commit_and_push` | 9 | 1 | 0 | 11.1% |
| `github__get_issue` | 9 | 0 | 0 | 0% |
| `filesystem__read_multiple_files` | 8 | 0 | 0 | 0% |
| `filesystem__edit_file` | 7 | 0 | 0 | 0% |
| `github__create_pr` | 7 | 0 | 0 | 0% |
| `github__get_pr` | 7 | 0 | 0 | 0% |
| `filesystem__search_files` | 6 | 0 | 0 | 0% |
| `github__check_merge_readiness` | 5 | 1 | 0 | 20% |
| `github__sync_branch` | 5 | 0 | 0 | 0% |
| `github__close_issue` | 4 | 0 | 4 | 0% |
| `github__submit_pr_review` | 4 | 0 | 0 | 0% |
| `github__get_issue_comments` | 3 | 0 | 0 | 0% |
| `github__merge_pr` | 3 | 0 | 0 | 0% |
| `github__get_branch` | 2 | 0 | 0 | 0% |
| `github__get_check_runs` | 2 | 0 | 0 | 0% |
| `engineering/environment` | 1 | 1 | 0 | 100% |
| `read_text_file` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 1,229 | 67.7% |
| `open` | 349 | 19.2% |
| `other` | 164 | 9% |
| `verify` | 49 | 2.7% |
| `edit` | 25 | 1.4% |

| skill | loads | share |
| --- | ---: | ---: |
| `project/conventions` | 6 | 33.3% |
| `engineering/tdd` | 4 | 22.2% |
| `review/quick-quality-gate` | 4 | 22.2% |
| `delivery/implementation-handoff` | 3 | 16.7% |
| `engineering/nonexistent` | 1 | 5.6% |

## All time

370 sessions.

**137,276,205 tokens** over 427 runs that reported them, **99.1% of it prompt** — what the agents were made to read, not what they wrote. Anything spent on making runs cheaper belongs on that side. No money here, deliberately: of the four providers only one reports a cost, and a price table goes quietly stale and then prints confident wrong numbers.

| | p50 | p90 | p99 | max | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| tokens per run | 24,639 | 302,887 | 6,403,430 | 39,737,697 | 137,276,205 |
| messages per session | 10 | 102 | 601 | 1,598 | 16,997 |

| agent | sessions | share |
| --- | ---: | ---: |
| `reviewer` | 240 | 64.9% |
| `engineer` | 93 | 25.1% |
| `orchestrator` | 37 | 10% |

**Refused** is the machinery saying no — a denylist, an allowlist, a hook. A guard working is not a tool breaking, and a reader cannot act on the two the same way, so they are counted apart. **Failed** is everything else that came back as an error, by string match, so it is an estimate.

| tool | calls | failed | refused | failure rate |
| --- | ---: | ---: | ---: | ---: |
| `shell__shell_execute` | 4,109 | 627 | 152 | 15.3% |
| `filesystem__read_text_file` | 593 | 43 | 24 | 7.3% |
| `shell__terminal_operate` | 587 | 313 | 20 | 53.3% |
| `filesystem_readonly__read_file` | 351 | 11 | 5 | 3.1% |
| `filesystem__list_directory` | 262 | 6 | 0 | 2.3% |
| `github__check_merge_readiness` | 226 | 2 | 0 | 0.9% |
| `filesystem__write_file` | 194 | 4 | 0 | 2.1% |
| `atoma_builtin__load_skill` | 190 | 77 | 0 | 40.5% |
| `github__get_issue` | 188 | 22 | 2 | 11.7% |
| `filesystem_readonly__list_directory` | 171 | 0 | 0 | 0% |
| `github__submit_pr_review` | 111 | 29 | 0 | 26.1% |
| `search__search_code` | 100 | 0 | 0 | 0% |
| `github__commit_and_push` | 94 | 53 | 0 | 56.4% |
| `github__search_code` | 84 | 31 | 0 | 36.9% |
| `github__get_pr` | 74 | 10 | 0 | 13.5% |
| `filesystem__create_directory` | 66 | 12 | 0 | 18.2% |
| `filesystem__edit_file` | 63 | 6 | 0 | 9.5% |
| `github__create_pr` | 59 | 24 | 0 | 40.7% |
| `filesystem__read_multiple_files` | 56 | 0 | 0 | 0% |
| `github__get_check_runs` | 55 | 6 | 0 | 10.9% |
| `filesystem__search_files` | 50 | 0 | 43 | 0% |
| `github__get_pr_diff` | 47 | 4 | 0 | 8.5% |
| `github__get_issue_comments` | 43 | 8 | 0 | 18.6% |
| `search__search_issues` | 39 | 4 | 0 | 10.3% |
| `github__close_issue` | 35 | 1 | 16 | 2.9% |
| `github__create_issue` | 35 | 4 | 0 | 11.4% |
| `github__merge_pr` | 35 | 1 | 0 | 2.9% |
| `github__list_issues` | 31 | 3 | 0 | 9.7% |
| `github__get_branch` | 30 | 13 | 0 | 43.3% |
| `filesystem_readonly__read_text_file` | 29 | 0 | 29 | 0% |
| `github__list_prs` | 29 | 0 | 0 | 0% |
| `web__fetch` | 29 | 1 | 0 | 3.4% |
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
| `github__sync_branch` | 13 | 7 | 0 | 53.8% |
| `filesystem__read_file` | 12 | 0 | 1 | 0% |
| `shell__terminal_close` | 12 | 4 | 0 | 33.3% |
| `atoma__request_close_issue` | 11 | 1 | 0 | 9.1% |
| `shell__shell_set_default_workdir` | 11 | 2 | 0 | 18.2% |
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
| `read_text_file` | 1 | 1 | 0 | 100% |
| `shell__ssh_execute` | 1 | 1 | 0 | 100% |
| `shell__terminals_terminal_operate` | 1 | 1 | 0 | 100% |
| `shell__write_file` | 1 | 1 | 0 | 100% |
| `terminal_operate` | 1 | 1 | 0 | 100% |
| `web__search` | 1 | 1 | 0 | 100% |

What the agents do when they reach for a shell. `search` without a matching `open` is the shape that produced this project's most expensive runs; `edit` against `verify` is the shape that turned out not to occur at all.

| act | calls | share |
| --- | ---: | ---: |
| `search` | 2,041 | 49.7% |
| `other` | 1,156 | 28.1% |
| `open` | 616 | 15% |
| `verify` | 205 | 5% |
| `edit` | 91 | 2.2% |

| skill | loads | share |
| --- | ---: | ---: |
| `review/quick-quality-gate` | 38 | 33.3% |
| `project/conventions` | 29 | 25.4% |
| `delivery/implementation-handoff` | 22 | 19.3% |
| `engineering/tdd` | 9 | 7.9% |
| `delivery/issue-decomposition` | 8 | 7% |
| `engineering/debugging` | 3 | 2.6% |
| `engineering/environment` | 2 | 1.8% |
| `research/web-search` | 2 | 1.8% |
| `engineering/nonexistent` | 1 | 0.9% |

## Degraded answers

A tool can answer and report that it answered badly — a search that came back unranked, a log that went nowhere. The call succeeded, so it is neither a failure nor a refusal, and it is easy for one of these to run for months with nobody reading it. **Read `last seen` before `reports`**: an old count is a fixed fault. That date is when the session file was last written, which is the run that touched it last and not necessarily the run that reported the problem — so it errs recent.

| last seen | server | reports | sessions | problem |
| --- | --- | ---: | ---: | --- |
| 2026-09-17 | `github` | 6 | 3 | [ops-log] WARN: failed to write op log: Error: ENOENT: no such file or directory, open '${RUNNER_TEMP}/atoma-run/atoma_o |
| 2026-09-17 | `search` | 2 | 2 | reranking failed (EACCES); these results are first-stage ordered, not reranked |
| 2026-09-17 | `github` | 2 | 1 | [atoma-github] WARN could not read links for #N: GraphQL query failed: gh: Could not resolve to an Issue with the number |
| 2026-09-17 | `search` | 2 | 2 | could not preload the reranker (EACCES), results are first-stage ordered |
| 2026-09-17 | `search` | 1 | 1 | [atoma-search] code query "what happens in the run loop when a tool call errors repeate" -> src/scripts/notify_limit_rea |
| 2026-09-17 | `search` | 1 | 1 | [atoma-search] code query "how does the runner handle a tool call that errors, does it " -> src/atoma/tools/scripts/mcp/ |
| 2026-09-17 | `shell` | 1 | 1 | [atoma-shell] exec: grep -n "error: \[atoma-search\]\\|error:\\|truncate\\|slice" src/atoma/tools/scripts/mcp/search.ts \| h |
| 2026-09-17 | `search` | 1 | 1 | [atoma-search] code query "when a tool call errors, does the loop retry the same call o" -> src/domain/pr-validation.tes |
| 2026-09-17 | `search` | 1 | 1 | could not preload the reranker (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge |
| 2026-09-17 | `search` | 1 | 1 | reranking failed (Error (N) occurred while trying to load file: "https://huggingface.co/onnx-community/bge-reranker-v2-m |

## Never used

Over all time, because something used once a year is still used. Each of these sits in the prompt of every run and returns nothing.

Every declared server has been called at least once.

The declared skills could not be read, so this cannot say which are unloaded.

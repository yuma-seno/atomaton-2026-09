#!/usr/bin/env bun
/**
 * files_guard.ts — counts a search made through the `files` server, and refuses one
 * once too many have gone by with nothing opened.
 *
 * ## Why this exists
 *
 * `shell_guard` has always counted searches, but only the ones made by running `grep`
 * in a shell. Giving the agents a real `grep` tool would otherwise have opened a path
 * around the counter: the same act, through a better door, uncounted. The rule would
 * then fire only on the agents that have a shell, and only for the searches they chose
 * to make the slow way.
 *
 * The rule itself is unchanged and lives in `domain/search-streak.ts`, which holds the
 * limit and the wording. This is the door, not the rule.
 *
 * ## What counts
 *
 * `grep`, `glob` and `list` answer *where* something is. `read` answers what it says,
 * and clears the counter through `note_file_opened`. That division is the whole point:
 * a run that enumerates for ever without opening anything is the shape being caught,
 * and it does not matter which tool it enumerates with.
 *
 * ## Fail-closed, and what that means here
 *
 * The core treats a non-zero exit or unparseable output from a `before_tool` hook as a
 * refusal. So every path that cannot decide answers `allow: true` explicitly rather
 * than falling through: a counter that cannot be read must leave the rule off, not
 * refuse every call the agent makes. `readStreak` is written to the same rule.
 */
import { nextStreak, refusalReason } from "../../../domain/search-streak.ts";
import { readStreak, streakFile, writeStreak } from "../lib/search-streak-file.ts";

/**
 * The tools here that answer "where".
 *
 * Named without a prefix because this server sets `unprefixed: true`, and matched
 * after stripping one anyway: the same file is declared as `files` and as
 * `files_readonly`, and a copy of this list keyed to one spelling would stop applying
 * to the other the day either is renamed.
 */
const SEARCHES = new Set(["grep", "glob", "list"]);

function allow(): void {
  console.log(JSON.stringify({ allow: true }));
}

async function main(): Promise<void> {
  let tool = "";
  try {
    const raw = await new Response(Bun.stdin.stream()).text();
    tool = String((JSON.parse(raw) as { tool?: unknown }).tool ?? "");
  } catch {
    // Unreadable input says nothing about what was called. Refusing here would refuse
    // every call rather than the one that could not be read.
    allow();
    return;
  }

  if (!SEARCHES.has(tool.trim().replace(/^.*__/, ""))) {
    allow();
    return;
  }

  // Advance and record before deciding, matching `shell_guard`: a refused search still
  // happened as far as the counter is concerned, and a counter that stood still while
  // the agent kept asking would never reach the limit at all.
  const file = streakFile();
  const streak = nextStreak(readStreak(file), "search");
  writeStreak(file, streak);

  const refusal = refusalReason(streak);
  if (refusal) {
    console.log(JSON.stringify({ allow: false, reason: refusal }));
    return;
  }
  allow();
}

if (import.meta.main) await main();

#!/usr/bin/env bun
/**
 * note_file_opened.ts — clears the search streak when a file was read through a
 * server other than `shell`.
 *
 * ## What it is for
 *
 * `shell_guard` refuses a search once fifteen have gone by with nothing opened, and
 * it counts opens by watching shell commands (`sed -n`, `head`, `cat`). A read done
 * with `filesystem__read_text_file` never passed through it, so the streak kept
 * climbing while the agent was doing exactly what the refusal asked for.
 *
 * That is not a small over-count. The refusal names `filesystem__read_text_file` by
 * name as the thing to do next, so an obedient agent is sent to the one act the
 * counter cannot see; the next search is refused identically, and the core stops the
 * run after three identical failures. Measured on issue #706: the streak went 15 to
 * 27, with two filesystem reads in the middle, and the run died. See
 * `domain/search-streak.ts` for the full account.
 *
 * ## Why an after-hook, and why on the server rather than file-wide
 *
 * After, because a read that failed opened nothing — the streak should clear on work
 * that happened, not on work that was attempted. On the filesystem servers, because
 * the file-wide `after_tool` slot holds one script and `workspace_guard` has it; a
 * tools file allows one per level and concatenates them, so a per-server declaration
 * is the free slot. `toolOpens` still matches on the tool rather than the server, so
 * the rule stays true if this is ever declared somewhere else.
 *
 * ## What it answers
 *
 * Nothing. An after-hook may return `{"notice": "..."}` to tell the agent something,
 * and there is nothing here worth the agent's attention: it asked to read a file and
 * the file arrived. Clearing a counter is the machinery's business. Every failure
 * path is silent for the same reason — this reports on a call that already succeeded,
 * and must never turn into a failure of it.
 */
import { writeFileSync } from "node:fs";
import { toolOpens } from "../../../../domain/search-streak.ts";
import { streakFile } from "../lib/search-streak-file.ts";

async function main(): Promise<void> {
  let tool = "";
  try {
    const raw = await new Response(Bun.stdin.stream()).text();
    tool = String((JSON.parse(raw) as { tool?: unknown }).tool ?? "");
  } catch {
    // Unreadable or unparseable input says nothing about whether a file was opened,
    // and the safe answer is to leave the counter where it is. Reading stdin at all
    // matters even when it is discarded: leaving the pipe unread closes it under the
    // writer.
    return;
  }

  if (!toolOpens(tool)) return;

  const file = streakFile();
  if (!file) return;
  try {
    writeFileSync(file, "0");
  } catch {
    // The run has nowhere to keep the counter. `shell_guard` reads an unreadable
    // counter as zero, so failing here leaves the rule off rather than stuck on.
  }
}

if (import.meta.main) await main();

/**
 * search-streak-file.ts — where the search streak is kept, and how it is read and
 * written, for the three hooks that have to agree about it.
 *
 * `shell_guard` advances it on a shell search and refuses on it; `files_guard` does
 * the same for a search made through the `files` server; `note_file_opened` clears it
 * when a read happens. Three processes, one counter, and nothing to hold it but a
 * file — each hook is a fresh process per tool call.
 *
 * It lives here rather than inside either hook because the failure it repairs was
 * exactly a disagreement about what clears the streak. A second copy of the path,
 * derived slightly differently, would be the same failure again in a new place: one
 * hook writing a counter the other never reads, silently, with no test able to see
 * the two apart.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The streak file, or `undefined` when the run did not say where its own directory is.
 *
 * Beside the ops log, which is the run's directory and is already written by this
 * user. With nowhere to keep state the rule is simply off — a guard that cannot
 * remember should do nothing rather than guess.
 */
export function streakFile(): string | undefined {
  const opsLog = process.env.ATOMATON_OPS_LOG;
  if (!opsLog) return undefined;
  const dir = opsLog.replace(/[/\\][^/\\]*$/, "");
  return dir === opsLog ? undefined : `${dir}/search-streak`;
}

/**
 * The streak so far. Every failure reads as zero.
 *
 * The hooks that advance this are fail-closed by contract — a non-zero exit or
 * unparseable output is taken as a refusal — so a bug in reading a counter would
 * refuse every call the agent makes through that server. Zero means the rule does not
 * fire, which is the only safe direction for it to be wrong in.
 *
 * Here rather than in one hook because two of them now advance the counter, and a
 * second copy of "what an unreadable counter means" is how the two would come to
 * disagree without anything failing.
 */
export function readStreak(file: string | undefined): number {
  if (!file) return 0;
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Silent on failure, for the same reason. */
export function writeStreak(file: string | undefined, streak: number): void {
  if (!file) return;
  try {
    writeFileSync(file, String(streak));
  } catch {
    // Nowhere to keep the counter. The next read sees zero and the rule stays off.
  }
}

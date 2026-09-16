/**
 * search-streak-file.ts — where the search streak is kept, for the two hooks that
 * have to agree about it.
 *
 * `shell_guard` advances the streak and refuses on it; a hook on the filesystem
 * servers clears it when a read happens there. Two processes, one counter, and
 * nothing to hold it but a file — each hook is a fresh process per tool call.
 *
 * It lives here rather than inside either hook because the failure it repairs was
 * exactly a disagreement about what clears the streak. A second copy of the path,
 * derived slightly differently, would be the same failure again in a new place: one
 * hook writing a counter the other never reads, silently, with no test able to see
 * the two apart.
 */

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

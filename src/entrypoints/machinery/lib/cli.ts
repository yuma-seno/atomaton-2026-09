/**
 * cli.ts — Tiny helper for building `--flag value` argv arrays from a typed
 * options object.
 *
 * Used on the *workflow-authoring* side (src/workflows/*.wac.ts, which may
 * import types -- and this pure helper -- from this self-contained
 * directory) so that invoking a script from a workflow step is checked
 * against that script's own exported `Args` interface: a typo'd or missing
 * required flag is a compile error, not a silently-wrong `bun run` command
 * discovered only at workflow-run time.
 *
 * Scope of the guarantee: this checks flag *names* and *shape* (required vs
 * optional, string/number/boolean) at TypeScript-authoring time. It cannot
 * check the runtime *value* GitHub Actions substitutes in (e.g.
 * `${{ github.event.pull_request.number }}`), since that's a bash-level
 * expression resolved only when the workflow actually runs -- an inherent
 * limit of generating shell commands, not something any TS layer can close.
 */
/**
 * Read the flags a script knows, ignoring loudly any it does not.
 *
 * For the two scripts a workflow runs from a DIFFERENT release than its own: the
 * jobs that deliberately check the default branch out — `plan_checks.ts --arm
 * default-branch` and `plan_deploy.ts`. Their workflow file comes from the branch
 * that was pushed and their script from the default branch, so for one cycle, during
 * an upgrade, the two are different releases.
 *
 * `parseArgs` is strict by default and throws `ERR_PARSE_ARGS_UNKNOWN_OPTION` on a
 * flag it has not heard of. Measured, on the self-deploy pull request for v0.1.156:
 * the new workflow passed `--repo`, the default branch still held v0.1.155's
 * `plan_deploy.ts`, and the planning job died — a red run on a branch that would
 * have deployed nothing anyway.
 *
 * `read_secret_names.ts` records the mirror image of this (issue #353): a release
 * whose workflow starts passing a flag the previous release's script does not
 * understand breaks its own deploy review, and the conclusion there was that a
 * missing argument is a degradation worth logging rather than one worth failing a
 * run over. An argument the script does not KNOW is the same fact from the other
 * side, so it gets the same answer — and it is said out loud, because "ignored a
 * flag" and "there was no flag" must not look alike afterwards.
 *
 * Every flag these scripts take is a string, so that is all this reads. Absent is
 * "", which is what each of them already treats as absent.
 */
export function parseAcrossReleases(names: readonly string[], argv: readonly string[]): Record<string, string> {
  const known = new Set(names);
  const values: Record<string, string> = Object.fromEntries(names.map((name) => [name, ""]));
  const ignored: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) continue;
    const [flag, inline] = splitFlag(token.slice(2));
    const value = inline ?? argv[index + 1] ?? "";
    if (inline === undefined) index += 1;
    if (known.has(flag)) values[flag] = value;
    else ignored.push(flag);
  }
  if (ignored.length > 0) {
    console.error(
      `::warning::Ignored ${ignored.map((flag) => `\`--${flag}\``).join(", ")}: this script is from an ` +
        "older release than the workflow that ran it. It will understand them once the upgrade reaches " +
        "the default branch.",
    );
  }
  return values;
}

/** `name=value` written as one token, or just the name. */
function splitFlag(token: string): [string, string | undefined] {
  const at = token.indexOf("=");
  return at === -1 ? [token, undefined] : [token.slice(0, at), token.slice(at + 1)];
}

export function toArgv<T extends Record<string, string | number | boolean | undefined>>(args: T): string[] {
  const argv: string[] = [];
  for (const [flag, value] of Object.entries(args)) {
    if (value === undefined) continue;
    // Double-quote every value: these argv arrays are joined with spaces and
    // spliced directly into a bash `run:` heredoc, so a value that is itself a
    // `${VAR}`/`${{ ... }}` expansion has to stay quoted or it word-splits.
    //
    // Quoting is NOT a safety boundary, and reading it as one is how an
    // injection gets written. Double quotes stop word splitting and globbing;
    // they do not stop `$(...)`, backticks, or `${...}`, all of which still
    // expand inside them. For a `${{ }}` expression that is doubly true: the
    // value is substituted into the script TEXT before bash parses it, so a
    // quote character in the value simply ends the string.
    //
    // What makes these call sites safe is therefore the value's provenance, not
    // this function. Values reaching a generated `run:` must be validated
    // before they get here -- see atomaton-runner.wac.ts's "Validate workflow
    // inputs" step, which is the boundary for every input that workflow splices
    // into shell text.
    argv.push(`--${flag}`, `"${String(value)}"`);
  }
  return argv;
}

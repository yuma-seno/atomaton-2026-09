/**
 * generated-file-hint.ts — naming the file a person can edit, when the core has named
 * the file it was handed.
 *
 * # The problem
 *
 * `atoma validate` is given `.github/atomaton/tools/tools.yaml` and reports on it by name.
 * That is correct for atoma, which knows nothing about this template: the tools file is
 * its input, and naming your input is what a validator does.
 *
 * It is wrong for the reader. Since the config redesign that file is **generated** from
 * `tools.servers` in `config.yaml` and rewritten on every build, so an adopter who opens
 * it and fixes what the message describes loses the fix at the next upgrade, silently.
 * Their own file is never mentioned.
 *
 * This is the same defect as a document naming a key that does not exist: a message the
 * reader cannot act on, carrying the machinery's authority. It is repaired here rather
 * than in the core because the core is right — only the delivery knows that the file it
 * handed over has a source.
 *
 * # What is not translated, and why
 *
 * Most of what the core reports about a tools file names the **server**: "Tool server
 * 'warehouse' names neither 'command' nor 'url'". A server name is the same word in
 * `tools.servers`, so the reader can already find it. Adding a hint to those would be
 * noise on messages that work.
 *
 * Only two shapes strand the reader, and both are here.
 */

/** Where an adopter actually writes what ends up in the tools file. */
const EDITABLE_SOURCE = "`tools.servers` in .github/atomaton/config.yaml";

/**
 * The core's problem, with a line naming the editable source when it needs one.
 *
 * Returns the problem unchanged when it does not — which is most of the time.
 */
export function withEditableSource(problem: string): string {
  // "Failed to parse tools YAML: ..." and anything else naming the generated file.
  // Rare, because the generator writes it with a serialiser; possible, because a
  // deployed tree can be edited by hand and this is exactly the person who did.
  if (problem.includes("tools.yaml")) {
    return (
      `${problem} — that file is generated from ${EDITABLE_SOURCE} and is rewritten on ` +
      "every build, so an edit to it is lost. Change the config."
    );
  }

  // "Hook script not found: '<resolved>' (resolved from '<what you wrote>')". The
  // resolved path is relative to the tools file's own directory, which is a directory
  // the adopter never named and cannot see from their config.
  if (problem.startsWith("Hook script not found")) {
    return (
      `${problem} — hook paths are resolved against .github/atomaton/tools/, and are ` +
      `declared in ${EDITABLE_SOURCE} (per server) or \`tools.watch\` (file-wide).`
    );
  }

  return problem;
}

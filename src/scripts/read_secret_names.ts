#!/usr/bin/env bun
/**
 * read_secret_names.ts — publishes, as a step output, which repository secrets
 * this project's configuration lets the AGENT's own process reach.
 *
 * `tools.secrets` is the only list read this way, and the only one that is a list
 * for a whole workflow. A check or a deployment declares its credentials per entry,
 * and those travel in the matrix its planning job published — see
 * `domain/delivery/declared-jobs.ts`. This used to take a `--destination`, back when `deploy`
 * had one list shared by every target it ran.
 *
 * The output feeds a computed-key lookup in a later step's `env:`
 * (`secrets[fromJSON(steps.<id>.outputs.names)[i]]`), which is what lets a
 * project add a credential without editing generated workflow YAML. See
 * domain/delivery/declared-secrets.ts for why it is shaped that way and what was measured
 * before relying on it.
 *
 * ## Why this reads a file it is handed, and not the checkout
 *
 * Every other script here reads `.github/atomaton/config.yaml` through
 * `adapters/runner/config.ts`, which resolves it against the working tree. This one must
 * not. On a pull request run the working tree is the pull request's own head --
 * `atomaton-runner.yml` checks out `refs/pull/N/head` -- so reading the declaration
 * from there would let a pull request decide which of the repository's secrets
 * are handed to the run reviewing it. The governance gate does not help: it
 * blocks the merge, and the run happens before the merge.
 *
 * The caller materialises the DEFAULT BRANCH's config.yaml and passes its path.
 * The distinction is deliberate and worth keeping straight: what a run *does*
 * comes from the branch under test, and what a run *may reach* comes from the
 * branch a person already approved.
 *
 * ## Failure behaviour
 *
 * No `--config`, or a file that cannot be read, declares nothing and says so.
 * Both fail closed: the run continues with no credentials rather than stopping,
 * and never falls back to the working tree, which is the thing a pull request
 * controls.
 *
 * `--config` is deliberately NOT required, though the workflow always passes it.
 * Requiring it made a deployment break itself: the release that first passed
 * `--config` met the previous release's workflow, which did not, and exited 2.
 * A missing argument is a degradation worth logging, not one worth failing a
 * run over — and `generated-workflows.test.ts` pins the workflow side, so it
 * cannot be dropped there without CI saying so.
 *
 * The record of that incident (issue #353) describes the failing run as reading
 * its workflow YAML from the base branch and its scripts from the pull request
 * — the split that made the previous release's workflow run against the new
 * release's scripts. For a `pull_request` event that description did not
 * reproduce: a workflow file that existed only in a pull request ran for that
 * pull request, so a `pull_request` run reads the workflow YAML from the merge
 * ref, not from the base branch. What is recorded from the incident and holds
 * regardless of the event is the ordering — a release whose workflow starts
 * passing a flag the previous release's workflow did not pass can break its own
 * deploy review — and that is the breakage requiring `--config` is kept
 * non-required against. The event-specific explanation is not repeated here
 * because it did not reproduce.
 *
 * An unusable declaration does fail the run. Delivering the names that happen to
 * be valid turns a typo into a failure much later, somewhere that points nowhere
 * near the cause.
 *
 * Usage:
 *   read_secret_names.ts [--config <path>]
 */
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveDeclaredSecrets, TOOL_SECRETS } from "../domain/delivery/declared-secrets.ts";
import { defineScript } from "./lib/script-ref.ts";

export interface ReadSecretNamesArgs {
  /** The trusted config.yaml to read the declaration from — NOT the working tree's. */
  config: string;
}

export const ref = defineScript<ReadSecretNamesArgs>(import.meta.url);

/** `tools.secrets` as this text declares it, or undefined when it declares none. */
export function declarationIn(configText: string): unknown {
  // Parsed here rather than through `adapters/runner/config.ts` on purpose: this text comes
  // from the default branch's object store, not from a file on disk, and the
  // separation is what keeps a missing ATOMATON_MACHINERY_ROOT from downgrading a
  // credential decision to the working tree.
  const config = Bun.YAML.parse(configText) as { tools?: { secrets?: unknown } };
  return config.tools?.secrets;
}

function main(): void {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { config: { type: "string" } } });
  let declared: unknown;
  if (!values.config) {
    console.error(
      "::warning::read_secret_names: no --config given, so no credentials are declared for this run. The workflow should pass the default branch's config.yaml.",
    );
  } else {
    try {
      declared = declarationIn(readFileSync(values.config, "utf8"));
    } catch (error) {
      console.error(`No credential declaration could be read (${(error as Error).message}); declaring none.`);
    }
  }

  const { names, problems } = resolveDeclaredSecrets(declared, TOOL_SECRETS);

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`::error::.github/atomaton/config.yaml: ${problem}`);
    }
    process.exit(1);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `names=${JSON.stringify(names)}\n`);
  }

  // Names only. The values are secrets; that these particular ones travel is
  // already public in config.yaml, and saying so makes a missing repository
  // secret diagnosable from the log.
  console.error(
    names.length > 0 ? `Secrets declared in \`tools.secrets\`: ${names.join(", ")}` : "No secrets are declared in `tools.secrets`.",
  );
}

if (import.meta.main) main();

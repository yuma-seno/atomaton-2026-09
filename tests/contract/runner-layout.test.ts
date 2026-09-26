/**
 * runner-layout.test.ts — the runner installs the machinery where the servers can
 * still resolve their imports.
 *
 * ## The failure this exists for
 *
 * Four defects of one shape landed in a single day, all green in CI, all found only
 * after deploying. The worst was a path: moving the machinery out of the work tree
 * put `node_modules` out of reach of the module-resolution walk, and the search
 * server could not start at all. Atoma treats a server that will not initialise as
 * fatal, so one unresolvable import took every run down.
 *
 * Nothing in CI said so, because nothing in CI ran a server. `atomaton-tools` does
 * now — it starts every server a pull request's definitions name — but it runs
 * against the pull request's own tree, where `node_modules` sits beside the
 * machinery. The arrangement that broke was the one a RUN has, and that is two
 * facts about where the runner puts things:
 *
 *   - the machinery lives at `${RUNNER_TEMP}/atomaton-machinery`, out of the work tree
 *   - the libraries a server imports live at `${RUNNER_TEMP}/node_modules`, beside it
 *
 * ## Why a string match rather than a run
 *
 * These are shell text inside a generated `run:` block, not values a module exports,
 * so there is nothing to import and nothing to execute. What can be held is that the
 * runner still says both — which is the half that moved silently. A server that
 * cannot start is caught by `atomaton-tools` on the pull request and by
 * `check-live-tools.sh` at the release; what neither would catch is the runner
 * changing the layout underneath them, because both would then be testing a layout
 * the runner no longer uses.
 *
 * The needles begin after the opening brace of the shell variable, which is not
 * fussiness: in that file the shell text lives inside TypeScript template literals,
 * so a dollar sign meant for the shell is written with a backslash before it, and a
 * needle spanning that escape silently never matches.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const RUNNER_WAC = "src/workflows/atomaton-runner.wac.ts";

/**
 * The two facts, each as the text the runner writes them with.
 *
 * Named rather than numbered so a failure says which one moved, and paired with the
 * sentence a reader needs to know what breaks if it does.
 */
const LAYOUT: readonly [name: string, needle: string, breaks: string][] = [
  [
    "machinery_out_of_the_work_tree",
    "RUNNER_TEMP}/atomaton-machinery",
    "the machinery would sit inside the work tree, where a run's own checkout can overwrite it",
  ],
  [
    "libraries_beside_the_machinery",
    'RUNNER_TEMP}" && bun add',
    "node_modules would land in the work tree, out of reach of the module-resolution walk a server starts with",
  ],
];

describe("where the runner installs the machinery", () => {
  const source = readFileSync(RUNNER_WAC, "utf8");

  for (const [name, needle, breaks] of LAYOUT) {
    test(`${name}: ${RUNNER_WAC} still says it`, () => {
      expect(
        source.includes(needle),
        `${RUNNER_WAC} no longer contains ${JSON.stringify(needle)}. If the layout moved, ` +
          `${breaks}. check-live-tools.sh and atomaton-tools both start servers against a ` +
          `layout they assume is this one, so they would go on passing while a run broke.`,
      ).toBe(true);
    });
  }
});

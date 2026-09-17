#!/usr/bin/env bun
/**
 * run_checks.ts — run config.yaml's `checks.atomaton_runs.commands`, in order,
 * stopping at the first failure.
 *
 * This is the body of `atomaton-check.yml`. The verification itself is
 * configuration rather than workflow YAML because an agent can write the former
 * and not the latter: GITHUB_TOKEN is refused on `.github/workflows/**` by
 * identity, on every path and every branch. A project whose checks an agent is
 * expected to author has to express them somewhere an agent can reach.
 *
 * Declaring nothing passes, loudly. This workflow is what runs when a project
 * names no `checks.your_workflow` of its own, so an empty list means every pull
 * request satisfies a required check that verified nothing — true of any
 * repository with no CI, but worth saying out loud rather than reporting a quiet
 * success. Failing instead would block every pull request in a repository from
 * the moment it adopts Atomaton until someone configures it, which is a worse first
 * hour and teaches nothing the warning does not.
 *
 * Mirrors GitHub Actions' own default `bash -e {0}` semantics: the first failing
 * command aborts with its exit code, so the job's conclusion is the command's.
 *
 * Usage:
 *   run_checks.ts
 */
import { getCheckCommands } from "../lib/config.ts";
import { defineScript } from "./lib/script-ref.ts";

export const ref = defineScript(import.meta.url);

function main(): void {
  const commands = getCheckCommands();
  if (commands.length === 0) {
    console.log(
      "::warning::This check verified nothing: `checks.atomaton_runs.commands` in .github/atomaton/config.yaml is empty, so a pull request satisfying it has not been tested. Add the commands that check this project, or point `checks.your_workflow` at a workflow of your own.",
    );
    return;
  }

  console.log(`Running ${commands.length} check command(s).`);
  for (const command of commands) {
    console.log(`::group::${command}`);
    const result = Bun.spawnSync({ cmd: ["bash", "-c", command], stdout: "inherit", stderr: "inherit" });
    console.log("::endgroup::");
    if (result.exitCode !== 0) {
      console.error(`::error::Check failed (exit ${result.exitCode}): ${command}`);
      process.exit(result.exitCode ?? 1);
    }
  }
  console.log("All checks passed.");
}

if (import.meta.main) main();

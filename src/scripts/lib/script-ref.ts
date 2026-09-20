/**
 * script-ref.ts — Gives each one-shot script in `src/scripts/` a
 * self-describing reference to its own identity, so workflow-authoring code
 * (`src/workflows/*.wac.ts`) never has to hand-type the script's deployed
 * path as a separate string.
 *
 * Call `defineScript<TArgs>(import.meta.url)` once at the top of a script
 * (right after its `Args` interface, if it has one) and export the result
 * as `ref`:
 *
 *   export interface FooArgs { ... }
 *   export const ref = defineScript<FooArgs>(import.meta.url);
 *
 * `import.meta.url` is populated by the runtime from the actual file being
 * executed/imported, so the derived path can never drift from the real
 * file -- a rename/move is automatically reflected.
 *
 * ## One place a `ref` must not be imported: another script
 *
 * `build-dist.ts` bundles each script in `src/scripts/` separately, and a bundled
 * non-entry module is handed the ENTRY's `import.meta.url`. So a script that imports
 * a sibling's `ref` gets a `runtimePath` naming ITSELF -- measured in the generated
 * bundle, where `write_tools_file.ts`'s `ref` came out as
 * `.github/atomaton-runtime/scripts/check_live_tools.ts`. The wrong value is a
 * perfectly good path to a real script, so nothing fails until the spawned program
 * turns out to be the wrong one.
 *
 * `src/workflows/*.wac.ts` importing a `ref` is the intended use and is unaffected:
 * the generator runs unbundled, one module per file. `tests/contract/script-refs.test.ts`
 * holds the line.
 *
 * This replaces the old
 * "path-validation-only `import type * as Foo`" convention: importing `ref`
 * is a real VALUE import, which already fails `tsc --noEmit` (TS2307) the
 * same way a type-only import did if the script is renamed/deleted, while
 * additionally carrying the actual runtime path -- so `scriptCommand()` (see
 * `src/workflows/actions/script-call.ts`) needs no separate hand-typed path
 * string at all.
 *
 * `TArgs` (for scripts whose CLI flags are a flat named-args object, built
 * via `toArgv()`) is carried on `ScriptRef` purely as a phantom type -- never
 * populated at runtime -- so `scriptCommandWithArgs()` can type-check the
 * `args` object passed at each call site directly against it, with no
 * separate import of the named `Args` interface needed at the call site.
 */
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where `build-dist.ts` places scripts inside a deployed `.github/`.
 *
 * Imported rather than written out. It was the literal `.github/scripts`, and when
 * the scripts moved under `.github/atomaton-runtime/` the build put them in the new
 * place while every generated workflow went on naming the old one -- so a deployed
 * run could not find the first script it tried, and nothing had said a word. The
 * deploy diff even showed the files being renamed, beside workflows that did not
 * follow them.
 */
import { SCRIPTS_DIR as SCRIPTS_RUNTIME_ROOT } from "../../domain/machinery-layout.ts";

export interface ScriptRef<TArgs = void> {
  /** Deployed runtime path, built from `SCRIPTS_RUNTIME_ROOT` above: `.github/scripts/foo.ts`. */
  readonly runtimePath: string;
  /**
   * Never populated -- a phantom marker so TypeScript treats `ScriptRef<A>`
   * and `ScriptRef<B>` as distinct types even though they're structurally
   * identical at runtime (both just `{ runtimePath }`).
   */
  readonly __argsType?: TArgs;
}

/**
 * Define a script's identity from its own `import.meta.url`. `TArgs` should
 * be the script's exported CLI-flags interface, e.g.
 * `defineScript<FooArgs>(import.meta.url)` -- omit it for scripts driven
 * purely by env vars, or with no external input at all.
 */
export function defineScript<TArgs = void>(importMetaUrl: string): ScriptRef<TArgs> {
  return { runtimePath: `${SCRIPTS_RUNTIME_ROOT}/${basename(fileURLToPath(importMetaUrl))}` };
}

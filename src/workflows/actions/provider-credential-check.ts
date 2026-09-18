/**
 * provider-credential-check.ts — refuse a run whose provider has no credential,
 * before it builds an environment it cannot use.
 *
 * ## What this prevents
 *
 * A run resolves its provider from the agent definition's `provider:`, then
 * `ATOMA_PROVIDER`, then the credentials that are set. Switching provider is an
 * ordinary thing to do, and forgetting the secret that goes with it is the
 * ordinary way to get it wrong. Nothing notices until the first inference —
 * after the checkout, the environment setup, the MCP package installs and the
 * tool servers have all run. The core's message is good, and it names the missing
 * credential, but it arrives one runner too late, and only a person can dispatch
 * the run again.
 *
 * ## Why the core answers this, and not this file
 *
 * `atoma validate` deliberately does NOT look at credentials: it runs in a pull
 * request, where a missing credential is not a defect in the file being checked,
 * and the core pins that decision (`a_known_provider_passes_without_its_credential`).
 * So this asks a second question, and asks it where the credentials actually are —
 * a runner, where the workflow already knows which secrets exist.
 *
 * The answer comes from the core rather than from here. Provider resolution, the
 * "exactly one credential" rule for auto-detection, and the table from a provider
 * to its credential name all live in the core. A copy of that table here would be
 * one duplication; a copy of the RESOLUTION rule built on top of it would be a
 * worse one, because the rule is the part that changes. This step passes an agent
 * definition and a variable through and reads an exit code.
 *
 * Which credentials it asks about is a fact about this repository and not about the
 * core: `RUN_CREDENTIALS` is what a run can carry, and `write_credentials_file.ts`
 * writes the same list. A provider whose credential is not on it cannot reach a run
 * at all, so reporting that one absent is what the run would find anyway.
 *
 * ## No secret value reaches this step
 *
 * `--credentials-present` takes NAMES, comma-separated, and never values. Every
 * entry this step is given is `${{ secrets.NAME != '' }}` — the boolean GitHub
 * computes — so the step can name the credential that is missing while holding
 * none of them. A value here would sit in a shell for the length of the step and
 * in its log.
 *
 * ## What it does not do
 *
 * It does not guess. "I could not ask" is not "there is no credential", so a check
 * that could not be carried out warns and lets the run continue: stopping a
 * healthy run on that difference costs more than the delay this saves. Nor does
 * it report a broken definition as a missing secret, which would send somebody to
 * create a secret that changes nothing.
 */
import { RUN_CREDENTIALS } from "../../domain/declared-secrets.ts";
import { AGENT_DEFINITIONS_DIR } from "../../domain/machinery-layout.ts";
import { TypedOutputsStep } from "./base.ts";
import { MACHINERY_ROOT } from "./script-call.ts";

/**
 * The credentials this step asks about.
 *
 * `GH_TOKEN` is excluded for the reason `runCredentialEnv()` excludes it: its
 * value is the run's own `${{ github.token }}` rather than a repository secret, so
 * `secrets.GH_TOKEN != ''` would answer "absent" about a token that exists. It is
 * also not what any provider authenticates with.
 */
const PROVIDER_CREDENTIALS = RUN_CREDENTIALS.filter((name) => name !== "GH_TOKEN");

/** The names, as shell words, for the two loops that walk them. */
const NAMES = PROVIDER_CREDENTIALS.join(" ");

/**
 * The step.
 *
 * Placement is load bearing in two directions and neither is visible from this
 * file: it must run BEFORE `environmentSetupStep()` — that build is the cost being
 * avoided — and AFTER "Install Atoma CLI", which is the binary that answers. See
 * the call site in `atomaton-runner.wac.ts`.
 *
 * ## Why it carries no `if:`
 *
 * "Run agent" is gated on `new_event_count != 0`, so a run with nothing to do skips
 * the agent and finishes green. That gate CANNOT be copied here: the count is
 * produced by "Merge GitHub context into session", which runs after environment
 * setup, so a step before the setup would read `steps.context.outputs...` as the
 * empty string — and `'' != '0'` is true. The condition would look like a gate,
 * evaluate like `true`, and be wrong the day somebody reordered the job expecting
 * it to hold.
 *
 * So the check runs on every run of the job, and what that costs is one `atoma
 * validate` on a duplicate dispatch. What it saves on the dispatch that is not a
 * duplicate is the whole runner. Saying so here rather than leaving the absence to
 * be read as an oversight.
 */
export function providerCredentialCheckStep(): TypedOutputsStep {
  return new TypedOutputsStep({
    name: "Check the resolved provider has a credential",
    shell: "bash",
    env: {
      // Presence, never value: GitHub evaluates `secrets.NAME != ''` and hands this
      // step the answer, not the secret. Generated from `RUN_CREDENTIALS` so a
      // seventh credential cannot be forgotten here — the omission would read as
      // "that one is not set", which refuses a run that is fine.
      ...Object.fromEntries(
        PROVIDER_CREDENTIALS.map((name) => [
          `${name}_PRESENT`,
          `\${{ secrets.${name} != '' }}`,
        ]),
      ),
      AGENT: "${{ inputs.agent }}",
      // Read as `_IN` and promoted below only when non-empty, exactly as the agent
      // step does it. An unset repository variable reaching the core as an EMPTY
      // `ATOMA_PROVIDER` would defeat auto-detection, and this step would then be
      // answering a different question than the run it is checking.
      ATOMA_PROVIDER_IN: "${{ vars.ATOMA_PROVIDER }}",
    },
    run: `# Which of this run's credentials exist, BY NAME. Every \`*_PRESENT\` value
# below is a boolean GitHub computed when this step started; no secret's value is
# in this shell.
PRESENT=""
for name in ${NAMES}; do
  eval "present=\\\${\${name}_PRESENT:-}"
  if [ "$present" = "true" ]; then
    PRESENT="\${PRESENT:+\${PRESENT},}$name"
  fi
done

# Promoted only when non-empty, the rule the agent step uses, so the two cannot
# disagree about which provider this run is about to use.
if [ -n "\${ATOMA_PROVIDER_IN:-}" ]; then
  export ATOMA_PROVIDER="\${ATOMA_PROVIDER_IN}"
fi

# The machinery's copy of the definition, not the checkout's: on a pull request
# run the checkout IS the pull request, and the file that decides the provider must
# not be one it supplied. See \`script-call.ts\`.
AGENT_DEF="${MACHINERY_ROOT}/${AGENT_DEFINITIONS_DIR}/\${AGENT}.md"

# The core resolves the provider and writes the message; this reads an exit code
# and repeats none of the reasoning. The flag is passed even when PRESENT is empty
# -- an empty list is a caller saying "none are set", which is a state the core is
# able to answer, and the one whose answer names every credential that would work.
OUT=$(mktemp)
STATUS=0
atoma validate --agent-def "$AGENT_DEF" --credentials-present "$PRESENT" > "$OUT" 2>&1 || STATUS=$?

# Nothing to say. A run whose provider is satisfied stays as quiet as it was before
# this step existed: \`atoma validate\` also prints its ordinary "parsed", "known
# provider" lines, and those are not worth a line in every run's log.
if [ "$STATUS" -eq 0 ]; then
  rm -f "$OUT"
  exit 0
fi

# 127 is "there is no atoma to ask"; 2 is "this atoma did not understand the
# question" -- a binary older than the flag, or a later one that renamed it.
# Neither is an answer about a credential, so neither may stop the run. What
# follows is the core's own provider error at the first inference, and this line is
# what connects it to the reason it was not caught here.
if [ "$STATUS" -eq 127 ] || [ "$STATUS" -eq 2 ]; then
  echo "::warning::could not ask atoma whether this run's provider has a credential (exit $STATUS). Continuing; a missing credential will surface as a provider error when the agent starts."
  rm -f "$OUT"
  exit 0
fi

# The core refused. It refuses for one of two reasons, and only the core can tell
# them apart -- so ask it the question that has no credential half. A definition
# that does not validate is a defect with its own message, and reporting it as a
# missing secret would send somebody to add a secret that changes nothing.
if ! atoma validate --agent-def "$AGENT_DEF" > /dev/null 2>&1; then
  echo "::warning::the agent definition at $AGENT_DEF does not validate, so whether this run's provider has a credential could not be checked. What follows is the definition's failure, not a missing secret:"
  cat "$OUT" >&2
  rm -f "$OUT"
  exit 0
fi

cat "$OUT" >&2

# Which credential names the core's own message mentions. Matching this run's list
# against that output is not parsing prose: if exactly one name appears, that is
# the credential the provider needs, and naming it in the annotation is what puts
# it in the summary rather than only in the log. Zero or several appearing leaves
# the output to speak for itself -- "no credential is set" lists all of them, and
# "more than one is set" is not a missing secret at all.
MISSING=""
MATCHES=0
for name in ${NAMES}; do
  if grep -q "$name" "$OUT"; then
    MISSING="$name"
    MATCHES=$((MATCHES + 1))
  fi
done
rm -f "$OUT"

if [ "$MATCHES" -eq 1 ]; then
  echo "::error::this run's provider authenticates with $MISSING, which this repository does not have. Add it under Settings > Secrets and variables > Actions, then dispatch the run again. Stopped before the environment was built, so no runner was spent on it."
else
  echo "::error::this run's provider could not be resolved with the credentials this repository has. The atoma output above says why, and names what is involved. Stopped before the environment was built, so no runner was spent on it."
fi
exit 1
`,
  });
}

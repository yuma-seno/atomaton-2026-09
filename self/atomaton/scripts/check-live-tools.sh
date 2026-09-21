#!/usr/bin/env bash
#
# check-live-tools.sh — start every tool server this release would ship, and hold
# what they advertise against the guards and the names its configuration declares.
#
# ## What it asks, and why a file cannot answer it
#
# `atoma validate --with-live-tools` starts the servers an agent definition names
# and asks each one for `tools/list`. Three things come out of that, and nothing
# else in this repository asks the first two:
#
#   - a `tool_allowlist` / `tool_denylist` pattern matching none of the tools its
#     server actually offers -- a guard that has stopped guarding. A run reports
#     that as a warning in a log nobody reads, and the allowlist in
#     `defaults.yaml` is the one this repository narrowed for `files_readonly`.
#   - two `unprefixed: true` servers offering the same tool name
#   - a server that will not start, or will not answer `tools/list` in time
#
# `probe-tool-servers.ts` starts every server too, and reads the tool list out of
# the model's request -- which proves a server came up and registered something.
# It does not ask whether a pattern in the tools file still names one of those
# tools, which is the half that needs the names as the server spells them.
#
# ## Why it runs here, and not on the pull request
#
# `validate_deliverable.ts` reads a pull request's `.github/atomaton/` as DATA and
# runs nothing under `--root`, and that is not a preference to be traded away:
# `tools.servers` lets a project -- or an agent -- name any `command`, so a check
# that started a pull request's declared servers would execute the pull request
# inside the job that decides whether it may merge. The live half therefore cannot
# go there. It goes to the other end of the same pipeline instead: the deployment
# job, on the default branch, after the artifact is built and before it is
# published.
#
# What that costs is that a guard which has stopped guarding is found after the
# merge that broke it rather than as a red check on its pull request. What it buys
# is that no pull request decides what runs -- the half that cannot be given up.
#
# ## Which tree, and who declared the servers
#
# `dist/` -- the artifact this run is about to publish -- and never `.github/`.
# `.github/` in this repository is the LAST RELEASE, put there by the self-deploy
# workflow, so it is a copy of something that already passed this check. `dist/`
# is built from the default branch by the step above, and is what an adopter
# receives. So every server started below is declared by the artifact itself: the
# shipped `atomaton-runtime/tools/defaults.yaml`, plus `tools.servers` in the
# shipped `atomaton/config.yaml`. No pull request's tree is read anywhere.
#
# ## What it does not install, and what that leaves unchecked
#
# The runner installs `tools.packages` before an agent starts; this does not. The
# only entry today is `@huggingface/transformers`, which `search.ts` imports lazily
# so that the server serves without it -- and installing it here would start a
# 544MB download inside a release job, for a reranker no check calls.
#
# What that leaves: a package a server needs in order to START is still caught,
# because the server then fails to start and that is fatal here. A package a server
# needs only in order to answer a CALL is not, and cannot be -- this check calls no
# tool.
#
# ## What it cannot see
#
# A duplicate tool name between two servers no single definition names. Each
# definition is validated against the servers IT names, and `atoma` refuses two
# `unprefixed` servers offering one name -- which is exactly why `files` and
# `files_readonly`, the same program both offering `read`, are never named by one
# agent. A definition naming both is itself the defect, and `atoma validate`
# rejects it. This is not a gap this script can close.
#
# Usage:
#   bash .github/atomaton/scripts/check-live-tools.sh
#
#   ATOMA_BIN=/path/to/atoma   check with this binary instead of downloading the pin
set -euo pipefail

# Asked of git rather than counted from this file's own location.
#
# It was `dirname "${BASH_SOURCE[0]}"/..`, which was right while this script sat in
# `scripts/` at the root and wrong the moment it moved to
# `.github/atomaton/scripts/`: the parent of its directory became `.github/atomaton/`,
# the `cd` landed there, and the first thing that reads `src/` failed. Nothing caught
# it, because every REFERENCE to this script was updated -- what moved silently was
# the path it derives from itself.
#
# A count of `..` is a claim about where a file lives. `--show-toplevel` is a
# question, and it has the same answer from anywhere in the checkout.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# The version a run installs, read from where the runner reads it. The checks below
# are the BINARY's, not this repository's, and `--with-live-tools` only exists from
# atoma v0.1.37 -- so a check on an older binary would report a clean pass having
# asked nothing. Read rather than written twice so raising the pin cannot leave
# this silently checking a different binary than an agent runs under.
VERSION="$(grep -o 'ATOMA_DEFAULT_VERSION = "[^"]*"' src/workflows/actions/atoma-cli.ts | head -1 | sed 's/.*"\(.*\)"/\1/')"
if [ -z "$VERSION" ]; then
  echo "::error::could not read ATOMA_DEFAULT_VERSION from src/workflows/actions/atoma-cli.ts"
  exit 1
fi

WORK="${RUNNER_TEMP:-/tmp}/atomaton-live-tools"
mkdir -p "$WORK"

BIN="${ATOMA_BIN:-}"
if [ -z "$BIN" ]; then
  BIN="$WORK/atoma"
  URL="https://github.com/yuma-seno/atoma/releases/download/${VERSION}/atoma-linux-x86_64"
  echo "Downloading ${VERSION} ..."
  # `--with-live-tools` exists only from atoma v0.1.37, so a binary this repository
  # cannot fetch is a check that would report a clean pass having asked nothing.
  # Failing is the honest answer; `probe-tool-health.sh` installs the same asset for
  # its own measurement, so this is a fetch the CI already depends on elsewhere.
  if ! curl -fsSL "$URL" -o "$BIN"; then
    echo "::error::could not download the atoma binary at ${VERSION} from ${URL}, so the live tool check could not run."
    exit 1
  fi
  chmod +x "$BIN"
fi
echo "Checking with $("$BIN" --version 2>&1 | head -1) (pin ${VERSION})"

MACHINERY="$REPO_ROOT/dist"
RUNTIME_TOOLS="$MACHINERY/.github/atomaton-runtime/tools"
DEFS_DIR="$MACHINERY/.github/atomaton/agent-definitions"

if [ ! -d "$MACHINERY/.github" ]; then
  echo "::error::$MACHINERY/.github does not exist, so there is nothing to check. Build the deliverable first (bun run synth)."
  exit 1
fi
if [ ! -d "$DEFS_DIR" ]; then
  echo "::error::$DEFS_DIR does not exist, so no definition could be checked and a clean pass would mean nothing."
  exit 1
fi

# Written the way a run writes it, from the config of the tree being checked, by
# the writer that ships in that same tree. There is no tools file to read: it
# stopped shipping when it became a per-run artifact, and one left behind would
# describe an older build than this.
TOOLS="$WORK/tools.yaml"
bun run "$MACHINERY/.github/atomaton-runtime/scripts/write_tools_file.ts" \
  --config "$MACHINERY/.github/atomaton/config.yaml" \
  --defaults "$RUNTIME_TOOLS/defaults.yaml" \
  --out "$TOOLS" \
  --hook-base "$RUNTIME_TOOLS"

# Every definition the artifact ships, rather than a chosen one: a server only the
# orchestrator names is still a server this release hands an adopter. One failure
# does not stop the loop, so a single run reports everything that is wrong.
status=0
checked=0
for def in "$DEFS_DIR"/*.md; do
  # No match leaves the pattern itself as the loop value, which would be reported as
  # a missing definition rather than as the empty directory it is. The count below is
  # what makes an empty directory fail instead of passing vacuously.
  [ -f "$def" ] || continue
  checked=$((checked + 1))
  echo "::group::atoma validate --with-live-tools $(basename "$def")"
  # `env -u GH_TOKEN`: what these servers are asked for is what they advertise and
  # nothing else, so they are started holding no token. This job's token can write
  # to the repository -- it publishes the release -- and a check that only lists
  # tools has no use for it. `atoma` expands `${GH_TOKEN}` in the tools file to the
  # empty string rather than refusing, which is what lets a check run without a
  # secret. `GITHUB_REPOSITORY` is left alone: the `github` server refuses to start
  # without it, and it names a repository rather than granting anything.
  ATOMATON_MACHINERY_ROOT="$MACHINERY" env -u GH_TOKEN "$BIN" validate \
    --agent-def "$def" \
    --tools-file "$TOOLS" \
    --with-live-tools || status=$?
  echo "::endgroup::"
done

if [ "$checked" -eq 0 ]; then
  echo "::error::$DEFS_DIR holds no agent definitions, so nothing was checked."
  exit 1
fi

if [ "$status" -ne 0 ]; then
  echo "::error::the tool servers this release would ship do not agree with the guards and the names its configuration declares. Not publishing it."
fi
exit "$status"

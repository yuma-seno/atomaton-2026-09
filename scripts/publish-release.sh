#!/usr/bin/env bash
#
# publish-release.sh — build the deliverable for a tag and publish it there.
#
# The second half of this project's own release, declared in `deploy.on_tag`.
# `tag-release.sh` is the first half and creates the tag this one runs off.
#
# ## Why the tag is the trigger
#
# Because `on_tag` is something this project ships, and shipping a thing you never
# use is how its defects stay invisible. Under the single script a tag was only ever
# an output, so the path that carries a tag into a deployment had no traffic on it at
# all — and the bug that made a machine-created tag unreachable sat there unnoticed.
#
# Now every release goes through it: the merge tags, the tag deploys. If that path
# breaks, the next release fails to publish rather than the failure waiting for
# somebody to go looking.
#
# It also makes a human tag mean something. Push `v1.2.3` at a commit on `main` and
# this runs, which is what an adopter reading `deploy.on_tag` would expect of it.
#
# ## Safe to run twice
#
# Deliberately, because the window between the tag and the release is recovered by
# re-running exactly this:
#
#     gh workflow run atomaton-deploy.yml --ref v1.2.3 -f target=publish
#
# It stops before building when the release already exists, so a re-run that was not
# needed costs a few seconds and changes nothing.
set -euo pipefail

TAG="${GITHUB_REF_NAME:-}"
if [ -z "$TAG" ]; then
  echo "::error::No tag in GITHUB_REF_NAME; this runs from a tag."
  exit 1
fi
if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::'$TAG' is not a release tag; expected v<semver>."
  exit 1
fi

# The workspace is the TAG's tree, so `package.json` here is what that tag declared.
# A mismatch means the tag was moved or was made by hand from somewhere else, and
# publishing it would put one version's name on another version's artifact.
VERSION=$(jq -r '.version // empty' package.json)
if [ "$TAG" != "v$VERSION" ]; then
  echo "::error::$TAG does not match this tree's package.json version ($VERSION); refusing to publish."
  exit 1
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "$TAG is already released; nothing to do."
  exit 0
fi
echo "$TAG has no release yet; building it."

bun install --frozen-lockfile
bun run synth

if [ ! -d dist/.github ]; then
  echo "::error::synth produced no dist/.github; nothing to package."
  exit 1
fi

# Before the artifact is packaged and published, ask the servers it would ship
# what they advertise, and hold that against the guards and the names its
# configuration declares. A `tool_allowlist` pattern matching none of its server's
# tools, two `unprefixed` servers claiming one name, and a server that will not
# start are all invisible to a file check and all fatal to a run.
#
# HERE rather than on the pull request, and that is the whole decision: this
# starts processes, and `tools.servers` lets a pull request name any `command`.
# The deliverable check reads a pull request's `.github/atomaton/` as data and runs
# nothing under `--root`; giving it this would make it execute the thing it is
# judging. So the live half runs against `dist/` -- the artifact built by the lines
# above and about to be published by the lines below.
#
# Below the early exit above, so it runs when a release is being CUT rather than on
# every tag. A tag that is already released rebuilds nothing and checks nothing,
# which is what makes a re-run cheap.
#
# See the script's header for what it can and cannot see.
bash scripts/check-live-tools.sh

# `zip` from inside dist/ so the archive holds `.github/...` and not
# `dist/.github/...`, and an adopter extracts it at their repository root.
# Naming `.github` explicitly is what includes it; a bare `zip -r .` would skip
# the dotfile entry.
#
# Deliberately a fixed asset name rather than one carrying the version: it is
# what makes `releases/latest/download/atomaton-delivery.zip` a stable URL, and the
# version is already carried by the release itself.
(cd dist && zip -qr ../atomaton-delivery.zip .github)
unzip -l atomaton-delivery.zip | tail -1

# `--verify-tag` rather than `--target`: the tag already exists and is what started
# this run, so creating it here would be a second place deciding which commit the
# release names. If it has gone, that is a fact worth failing on rather than
# quietly re-creating from whatever this workspace happens to be.
gh release create "$TAG" atomaton-delivery.zip \
  --title "$TAG" \
  --verify-tag \
  --generate-notes

#!/usr/bin/env bash
#
# tag-release.sh — put the tag on, and nothing else.
#
# The first half of this project's own release, declared in `deploy.on_merge`.
# `publish-release.sh` is the second half and runs off the tag this one creates.
#
# ## Why it is two halves
#
# It was one script: build, check, publish, and create the tag as a side effect of
# `gh release create --target`. That worked, and it meant a tag was never a trigger
# here — this repository shipped `on_tag` and never once used it, so the bug that
# made machine-created tags invisible to it went unnoticed until it was looked for.
# A deliverable whose own first adopter does not use half of it is a deliverable with
# a half nobody is watching.
#
# So the tag is the trigger now. This creates it; the tag's own deployment publishes.
#
# ## What that costs, stated rather than hidden
#
# A window. Between this and a successful publish, the tag exists with no release
# behind it. The single script had no such window, and that was its best property.
#
# It is bounded and it is recoverable: the publish is idempotent, and re-running it
# is one dispatch —
#
#     gh workflow run atomaton-deploy.yml --ref "$TAG" -f target=publish
#
# What this script will not do is create the tag twice, so a failed publish is never
# hidden by the next merge quietly starting over.
#
# The version is not passed in. `package.json`'s `version` is the single declaration
# and the tag is derived from it, so the two cannot disagree. Releasing is therefore
# an ordinary reviewed change: bump the version, and merging it tags.
#
# Idempotent, and that is what makes `on_merge` safe. This runs after every merge and
# stops immediately when the version already has a release.
set -euo pipefail

VERSION=$(jq -r '.version // empty' package.json)
if [ -z "$VERSION" ]; then
  echo "::error::package.json declares no version; nothing can be released."
  exit 1
fi

# The version reaches a tag name and a filename, so keep it to a shape that
# cannot mean anything else.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::package.json version '$VERSION' is not a plain semver string."
  exit 1
fi

TAG="v$VERSION"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "$TAG is already released; nothing to do."
  exit 0
fi

# The tag without the release is the window above. Say which of the two states this
# is, because "nothing to do" would read the same for both and only one of them
# means somebody has to act.
if gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$TAG" >/dev/null 2>&1; then
  echo "::warning::$TAG is tagged but not released, so a publish did not finish. Re-run it with:"
  echo "::warning::  gh workflow run atomaton-deploy.yml --ref \"$TAG\" -f target=publish"
  exit 0
fi

echo "$TAG has no tag yet; creating it at $GITHUB_SHA."
gh api -X POST "repos/$GITHUB_REPOSITORY/git/refs" \
  -f "ref=refs/tags/$TAG" \
  -f "sha=$GITHUB_SHA" >/dev/null

# And now nothing happens, which is the part worth knowing about. GitHub starts no
# workflow run for an event its own token caused, so this tag announces itself to
# nobody. The run that created it dispatches the tag's deployment instead --
# `dispatch_new_tags.ts`, from the job that follows this one.
echo "Tagged $TAG. Its deployment is dispatched by the run that created it."

#!/usr/bin/env bash
# Publish the matched PR screenshots to the `screenshots` orphan branch
# under `pr-<PR_NUMBER>/`. Creates the branch on first run.
#
# Required env:
#   PR_NUMBER, HEAD_SHA, GITHUB_TOKEN, GITHUB_REPOSITORY
# Required argv:
#   $1 — directory containing matched PNGs (will be the contents of pr-<n>/)
set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER not set}"
: "${HEAD_SHA:?HEAD_SHA not set}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN not set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

SRC_DIR_RAW="${1:?usage: publish-pr-screenshots.sh <src-dir>}"
BRANCH="${SCREENSHOT_BRANCH:-screenshots}"

# Resolve the source directory to an absolute path BEFORE we `cd` into
# the work directory below. The previous version of this script kept
# `$SRC_DIR` as the relative path the workflow passed in (`pr-staging`),
# then walked into `$WORK` and tried to read it — `cp` errored with
# "cannot stat 'pr-staging/.': No such file or directory" because the
# relative lookup was happening from /tmp instead of $GITHUB_WORKSPACE.
if [ ! -d "$SRC_DIR_RAW" ]; then
  echo "publish-pr-screenshots: source directory '$SRC_DIR_RAW' does not exist" >&2
  exit 1
fi
SRC_DIR="$(cd "$SRC_DIR_RAW" && pwd)"

# Use a sibling workdir so we never disturb the PR checkout. `mktemp -d`
# is portable across the runner's Ubuntu image and macOS-style local runs.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

# Set the git identity on the local worktree only. The CI runner's global
# config stays untouched, and we use github-actions[bot] so the commit
# author lines up with the workflow that produced it.
cd "$WORK"
git init -q
git remote add origin "$REMOTE"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# Probe the remote for the screenshots branch before deciding whether to
# fetch it or bootstrap. The previous version used
# `git fetch ... 2>/dev/null` and treated any non-zero exit as "branch
# missing", which would silently route a transient network blip through
# the bootstrap path and clobber the existing branch on push. `ls-remote`
# is cheap, exits 0 with an empty result for a missing branch, and
# surfaces real failures (auth, DNS) on stderr.
remote_ref="$(git ls-remote --heads origin "$BRANCH")"
if [ -n "$remote_ref" ]; then
  git fetch -q --depth=1 origin "$BRANCH"
  git checkout -q -b "$BRANCH" FETCH_HEAD
else
  echo "screenshots branch does not exist on remote — bootstrapping"
  git checkout -q --orphan "$BRANCH"
  git rm -rf --quiet . 2>/dev/null || true
  cat > README.md <<EOF
# Screenshots branch

Auto-published storybook screenshots for open / recent pull requests.
Each PR gets a \`pr-<number>/\` directory; the CI workflow rewrites it on
every PR update. Safe to prune old directories — they are recreated on
the next push to that PR's branch.
EOF
  git add README.md
  git commit -q -m "init screenshots branch"
fi

# Replace the PR's directory wholesale so deleted stories disappear.
rm -rf "pr-${PR_NUMBER}"
mkdir -p "pr-${PR_NUMBER}"
# `$SRC_DIR` is now absolute; the `/.` suffix copies the directory's
# *contents* (so an empty source still copies cleanly — nothing happens —
# and the post-stage `git diff --cached --quiet` handles the
# "no screenshots to publish" outcome below).
cp -R "$SRC_DIR"/. "pr-${PR_NUMBER}/"
git add "pr-${PR_NUMBER}"

# Empty PR directory (no matching screenshots) → nothing to commit. Exit
# clean so the workflow can still post the "no story changes" comment.
if git diff --cached --quiet; then
  echo "no screenshot changes to publish"
  exit 0
fi

git commit -q -m "pr-${PR_NUMBER}: screenshots @ ${HEAD_SHA:0:7}"
# `--force-with-lease` would be ideal but we don't have a stored ref to
# lease against on the bootstrap path; the branch is purely a publishing
# surface — last writer wins per PR directory.
git push -q origin "HEAD:${BRANCH}"
echo "pushed pr-${PR_NUMBER}/ to ${BRANCH}"

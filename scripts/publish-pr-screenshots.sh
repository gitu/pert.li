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

SRC_DIR="${1:?usage: publish-pr-screenshots.sh <src-dir>}"
BRANCH="${SCREENSHOT_BRANCH:-screenshots}"

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

# Try to fetch an existing screenshots branch; if it does not exist on the
# remote, bootstrap it as an orphan branch instead.
if git fetch --depth=1 origin "$BRANCH" 2>/dev/null; then
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
cp -R "${SRC_DIR}"/. "pr-${PR_NUMBER}/"
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

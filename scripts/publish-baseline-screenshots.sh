#!/usr/bin/env bash
# Update the storybook screenshot baseline on the `screenshots` orphan branch,
# under `baseline/<story-id>.png`. Runs on push to main (storybook.yml).
#
# Unlike the per-PR publisher, this applies only the DELTA: stories the diff
# flagged as changed / new get their PNG replaced, removed stories get deleted,
# and everything the heuristic considered visually identical is left untouched.
# That keeps each baseline commit to just the stories that actually moved —
# no churn from run-to-run pixel noise on unchanged renders.
#
# Required env:
#   HEAD_SHA, GITHUB_TOKEN, GITHUB_REPOSITORY
# Required argv:
#   $1 — changed-stories JSON produced by diff-screenshots.mjs (existing
#        baseline vs. the fresh main render)
#   $2 — directory holding the fresh main render (<id>.png per story)
set -euo pipefail

: "${HEAD_SHA:?HEAD_SHA not set}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN not set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

CHANGED_JSON_RAW="${1:?usage: publish-baseline-screenshots.sh <changed-stories.json> <render-dir>}"
RENDER_DIR_RAW="${2:?usage: publish-baseline-screenshots.sh <changed-stories.json> <render-dir>}"
BRANCH="${SCREENSHOT_BRANCH:-screenshots}"

# Resolve inputs to absolute paths BEFORE we cd into the work directory —
# the workflow passes relative paths from $GITHUB_WORKSPACE.
if [ ! -f "$CHANGED_JSON_RAW" ]; then
  echo "publish-baseline-screenshots: '$CHANGED_JSON_RAW' does not exist" >&2
  exit 1
fi
if [ ! -d "$RENDER_DIR_RAW" ]; then
  echo "publish-baseline-screenshots: render dir '$RENDER_DIR_RAW' does not exist" >&2
  exit 1
fi
CHANGED_JSON="$(cd "$(dirname "$CHANGED_JSON_RAW")" && pwd)/$(basename "$CHANGED_JSON_RAW")"
RENDER_DIR="$(cd "$RENDER_DIR_RAW" && pwd)"

# Pull the apply-lists out of the diff JSON up front (needs jq, present on
# ubuntu-latest). `changed` includes resized stories — both want the new PNG.
CHANGED_IDS="$(jq -r '.stories[] | select(.status=="changed" or .status=="new") | .id' "$CHANGED_JSON")"
REMOVED_IDS="$(jq -r '.stories[] | select(.status=="removed") | .id' "$CHANGED_JSON")"

if [ -z "$CHANGED_IDS" ] && [ -z "$REMOVED_IDS" ]; then
  echo "no baseline changes to publish"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

cd "$WORK"
git init -q
git remote add origin "$REMOTE"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# Probe for the branch (cheap, exits 0 with empty output when missing) instead
# of relying on a swallowed fetch error — a transient blip must not route us
# through the bootstrap path and clobber the existing baseline.
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

Auto-published storybook screenshots.

- \`baseline/\` — the current visual baseline for \`main\`, one PNG per story id.
  Updated on every push to main, committing only the stories that changed.
- \`pr-<number>/\` — per-PR renders + diff overlays for stories that differ from
  the baseline. Rewritten on every PR update; safe to prune.
EOF
  git add README.md
  git commit -q -m "init screenshots branch"
fi

mkdir -p baseline

# Apply the delta. Copy changed/new renders in; drop removed stories.
while IFS= read -r id; do
  [ -z "$id" ] && continue
  src="${RENDER_DIR}/${id}.png"
  if [ -f "$src" ]; then
    cp "$src" "baseline/${id}.png"
  else
    echo "::warning::diff flagged '$id' as changed/new but no render found at $src"
  fi
done <<< "$CHANGED_IDS"

while IFS= read -r id; do
  [ -z "$id" ] && continue
  rm -f "baseline/${id}.png"
done <<< "$REMOVED_IDS"

git add -A baseline

# Nothing actually staged (e.g. flagged renders were all missing) → exit clean.
if git diff --cached --quiet; then
  echo "no baseline changes to publish"
  exit 0
fi

n_changed="$(printf '%s\n' "$CHANGED_IDS" | grep -c . || true)"
n_removed="$(printf '%s\n' "$REMOVED_IDS" | grep -c . || true)"
git commit -q -m "baseline: update ${n_changed} changed, ${n_removed} removed @ ${HEAD_SHA:0:7}"
git push -q origin "HEAD:${BRANCH}"
echo "pushed baseline update to ${BRANCH} (${n_changed} changed, ${n_removed} removed)"

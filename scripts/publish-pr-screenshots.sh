#!/usr/bin/env bash
# Commit freshly-rendered Storybook screenshots back onto the PR branch.
#
# Screenshots are committed visual-regression baselines tracked at
# `screenshots/<story-id>.png`. The CI render step overwrites those files
# in place; this script stages the baseline dir, and — only when a baseline
# actually changed — commits the result and pushes it to the PR head branch.
# GitHub then renders the before/after natively in the PR's "Files changed"
# tab. Identical renders stage no diff, so a no-op PR adds no commit.
#
# Runs INSIDE the PR-head checkout: `origin` must be the writable remote
# (actions/checkout wires that up with the push token), and HEAD is the PR
# branch. We deliberately push with a token that re-triggers CI so the new
# head commit gets its required checks; the follow-up run re-renders, finds
# the baselines already match, commits nothing, and stops.
#
# Required env:
#   HEAD_REF          — PR head branch to push to
#                       (github.event.pull_request.head.ref)
# Optional env:
#   SCREENSHOTS_DIR   — baseline directory (default: screenshots)
#   PR_NUMBER         — included in the commit subject
#   NAME_STATUS_OUT   — when set, write `git diff --name-status` of the
#                       staged screenshot changes here (the comment builder
#                       reads it to summarize added/changed/removed stories)
#   GITHUB_OUTPUT     — when set, receives `screenshot_changed` and
#                       `screenshot_sha` step outputs
set -euo pipefail

: "${HEAD_REF:?HEAD_REF not set}"
SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-screenshots}"

# Append a `key=value` line to $GITHUB_OUTPUT when running under Actions;
# a no-op locally and in the test harness.
emit() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		echo "$1" >>"$GITHUB_OUTPUT"
	fi
}

# Set identity on the local repo only — the runner's global config (and a
# developer's, if this is ever run locally) stays untouched.
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# `mkdir -p` so the first-ever run (before the baseline dir is seeded)
# still has a pathspec to stage. `-A` picks up adds, modifications, and
# deletions (a removed story drops its PNG) within the dir.
mkdir -p "$SCREENSHOTS_DIR"
git add -A "$SCREENSHOTS_DIR"

if git diff --cached --quiet -- "$SCREENSHOTS_DIR"; then
	echo "no screenshot baseline changes"
	emit "screenshot_changed=false"
	exit 0
fi

# Capture the change list for the sticky comment before committing.
if [ -n "${NAME_STATUS_OUT:-}" ]; then
	git diff --cached --name-status -- "$SCREENSHOTS_DIR" >"$NAME_STATUS_OUT"
fi

git commit -q -m "chore: update story screenshots${PR_NUMBER:+ (pr-${PR_NUMBER})}"
sha="$(git rev-parse HEAD)"
git push -q origin "HEAD:${HEAD_REF}"
echo "pushed screenshot baselines to ${HEAD_REF} @ ${sha:0:7}"
emit "screenshot_changed=true"
emit "screenshot_sha=${sha}"

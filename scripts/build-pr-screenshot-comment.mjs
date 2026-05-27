#!/usr/bin/env node
// Produce the markdown body for the sticky "PR screenshots" comment.
//
// Inputs (env / argv):
//   $REPO              — "owner/name" (defaults to $GITHUB_REPOSITORY)
//   $SCREENSHOT_BRANCH — branch where images live (default: "screenshots")
//   $PR_NUMBER         — PR number
//   $HEAD_SHA          — head commit SHA (links the comment to the source)
//   argv[2]            — path to the changed-stories JSON
//   argv[3]            — directory holding the rendered PNGs
//   argv[4]            — output markdown file (default: stdout)
//
// For each story in the input JSON, we render a plain markdown link to
// the published image on the screenshots branch — pointing at
// github.com/<repo>/blob/<branch>/<path>, NOT raw.githubusercontent.com.
// Two reasons:
//   1. The repo is private. raw.githubusercontent.com only authenticates
//      via an Authorization header (token); browser sessions don't carry
//      one against that subdomain, so the URL 404s when a reviewer
//      clicks it. github.com/<repo>/blob/... works under the reviewer's
//      existing session and renders the PNG inline in the file viewer.
//   2. We also avoid `<img>` tags entirely: GitHub's Camo image proxy
//      that fetches `<img src>` URLs in PR comments is anonymous and
//      would 404 against either subdomain for a private repo. Plain
//      `<a>` links sidestep Camo.
// Stories whose PNG is missing on disk are listed as "(render failed)".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Pure helper: given the parsed changed-stories payload and a predicate
// telling us which screenshots actually landed on disk, produce the
// markdown body that the sticky comment action posts. Exported so the
// unit test can exercise grouping / fallback behavior without touching
// the filesystem.
export function renderComment({ stories, repo, prNumber, branch = "screenshots", headSha = "", hasScreenshot }) {
	const urlBase = `https://github.com/${repo}/blob/${branch}/pr-${prNumber}`;
	const lines = ["## 📸 PR screenshots", ""];

	if (!stories || stories.length === 0) {
		lines.push("_No story directories were touched by this PR._");
	} else {
		lines.push(
			`Rendered ${stories.length} stor${stories.length === 1 ? "y" : "ies"} from files touched in this PR.`,
		);
		lines.push("");
		const byTitle = new Map();
		for (const story of stories) {
			if (!byTitle.has(story.title)) byTitle.set(story.title, []);
			byTitle.get(story.title).push(story);
		}
		for (const [title, group] of byTitle) {
			lines.push(`### ${title}`);
			lines.push(`<sub>\`${group[0].file}\`</sub>`);
			lines.push("");
			for (const story of group) {
				if (hasScreenshot(story)) {
					const url = `${urlBase}/${story.id}.png`;
					lines.push(`- [${story.name}](${url})`);
				} else {
					lines.push(`- **${story.name}** — _render failed_`);
				}
			}
			lines.push("");
		}
	}

	if (headSha) {
		lines.push("");
		lines.push(`<sub>updated for ${headSha.slice(0, 7)}</sub>`);
	}

	return `${lines.join("\n")}\n`;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith("build-pr-screenshot-comment.mjs");

if (invokedDirectly) {
	const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
	const branch = process.env.SCREENSHOT_BRANCH || "screenshots";
	const prNumber = process.env.PR_NUMBER;
	const headSha = process.env.HEAD_SHA || "";

	const changedStoriesPath = process.argv[2];
	const screenshotDir = process.argv[3];
	const outPath = process.argv[4];

	if (!repo || !prNumber || !changedStoriesPath || !screenshotDir) {
		process.stderr.write(
			"usage: REPO=… PR_NUMBER=… build-pr-screenshot-comment.mjs <changed-stories.json> <screenshot-dir> [out.md]\n",
		);
		process.exit(2);
	}

	const { stories } = JSON.parse(readFileSync(changedStoriesPath, "utf8"));
	const body = renderComment({
		stories,
		repo,
		prNumber,
		branch,
		headSha,
		hasScreenshot: (story) => existsSync(path.join(screenshotDir, `${story.id}.png`)),
	});

	if (outPath) {
		writeFileSync(outPath, body);
	} else {
		process.stdout.write(body);
	}
}

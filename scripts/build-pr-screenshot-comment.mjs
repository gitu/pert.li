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
// For each story in the input JSON we embed the PNG inline via a
// markdown image pointed at raw.githubusercontent.com on the
// screenshots branch. The repo is public, so GitHub's Camo image
// proxy can fetch the raw URL anonymously and the image renders in
// the PR conversation without the reviewer having to click through.
// We also wrap the image in a link to the same raw URL so a click
// opens the full-size PNG.
// Stories whose PNG is missing on disk are listed as "(render failed)".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Pure helper: given the parsed changed-stories payload and a predicate
// telling us which screenshots actually landed on disk, produce the
// markdown body that the sticky comment action posts. Exported so the
// unit test can exercise grouping / fallback behavior without touching
// the filesystem.
export function renderComment({ stories, repo, prNumber, branch = "screenshots", headSha = "", hasScreenshot }) {
	const urlBase = `https://raw.githubusercontent.com/${repo}/${branch}/pr-${prNumber}`;
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
					lines.push(`**${story.name}**`);
					lines.push("");
					lines.push(`[![${story.name}](${url})](${url})`);
					lines.push("");
				} else {
					lines.push(`**${story.name}** — _render failed_`);
					lines.push("");
				}
			}
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

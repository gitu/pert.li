#!/usr/bin/env node
// Produce the markdown body for the sticky "Visual changes" PR comment.
//
// Inputs (env / argv):
//   $REPO              — "owner/name" (defaults to $GITHUB_REPOSITORY)
//   $SCREENSHOT_BRANCH — branch where images live (default: "screenshots")
//   $PR_NUMBER         — PR number
//   $HEAD_SHA          — head commit SHA (links the comment to the source)
//   argv[2]            — path to the diff-screenshots JSON (changed-stories.json)
//   argv[3]            — directory holding the staged PNGs (<id>.png + <id>.diff.png)
//   argv[4]            — output markdown file (default: stdout)
//
// The stories in the input JSON are only the ones that differ from the
// baseline (diff-screenshots.mjs omits unchanged stories). Each is rendered
// according to its status:
//   - changed        → new render + pixel-diff overlay, both linked full-size
//   - changed + size  → new render only (dimensions changed, no overlay)
//   - new            → new render only, flagged as a new story
//   - removed        → text line, no image
// Images embed via raw.githubusercontent.com on the screenshots branch; the
// repo is public so GitHub's Camo proxy fetches them anonymously and they
// render inline. Each image links to the same raw URL for a full-size view.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function img(name, url) {
	return `[![${name}](${url})](${url})`;
}

// Pure helper: given the diff payload and a predicate telling us which PNGs
// actually landed on disk, produce the sticky-comment markdown. Exported so
// the unit test can exercise the per-status rendering without the filesystem.
export function renderComment({
	stories,
	repo,
	prNumber,
	branch = "screenshots",
	headSha = "",
	hasScreenshot,
}) {
	const urlBase = `https://raw.githubusercontent.com/${repo}/${branch}/pr-${prNumber}`;
	const lines = ["## 📸 Visual changes", ""];

	if (!stories || stories.length === 0) {
		lines.push("_No stories changed visually against the `main` baseline._");
	} else {
		const n = stories.length;
		lines.push(
			`${n} stor${n === 1 ? "y" : "ies"} changed visually against the \`main\` baseline.`,
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
				if (story.status === "removed") {
					lines.push(`**${story.name}** — 🗑 _story removed_`);
					lines.push("");
					continue;
				}
				if (!hasScreenshot(story, "png")) {
					lines.push(`**${story.name}** — _render failed_`);
					lines.push("");
					continue;
				}
				const label =
					story.status === "new"
						? `**${story.name}** — 🆕 _new story_`
						: story.sizeChanged
							? `**${story.name}** — ↔ _size changed_`
							: `**${story.name}**`;
				lines.push(label);
				lines.push("");
				lines.push(img(story.name, `${urlBase}/${story.id}.png`));
				lines.push("");
				// Only `changed` stories of equal size carry a diff overlay.
				if (
					story.status === "changed" &&
					!story.sizeChanged &&
					hasScreenshot(story, "diff.png")
				) {
					lines.push(img(`${story.name} diff`, `${urlBase}/${story.id}.diff.png`));
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

const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]).endsWith("build-pr-screenshot-comment.mjs");

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
		hasScreenshot: (story, suffix) =>
			existsSync(path.join(screenshotDir, `${story.id}.${suffix}`)),
	});

	if (outPath) {
		writeFileSync(outPath, body);
	} else {
		process.stdout.write(body);
	}
}

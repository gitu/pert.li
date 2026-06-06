#!/usr/bin/env node
// Produce the markdown body for the sticky "PR screenshots" comment.
//
// Screenshots are committed visual-regression baselines tracked at
// `screenshots/<story-id>.png`. The CI `pr-screenshots` job re-renders the
// affected stories, overwrites those files in place, and auto-commits any
// real pixel changes onto the PR branch. The *actual* before/after diff is
// rendered by GitHub's native image viewer in the PR's "Files changed" tab
// (2-up / swipe / onion-skin) — this comment is just a lightweight index
// that summarizes which stories changed and links straight to that tab.
//
// Inputs (env / argv):
//   $REPO              — "owner/name" (defaults to $GITHUB_REPOSITORY)
//   $PR_NUMBER         — PR number (used for the Files-changed deep link)
//   $SCREENSHOT_REF    — commit SHA the baselines now live at (for thumbnails)
//   argv[2]            — path to `git diff --name-status` output (screenshots/)
//   argv[3]            — path to the changed-stories JSON (for id -> title/name)
//   argv[4]            — output markdown file (default: stdout)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Pure parser: turn `git diff --name-status -- screenshots/` output into
// added / modified / removed story-id lists. Each line is a status char
// (A/M/D, or R### for renames) followed by tab-separated path(s). We only
// care about files under `screenshots/` ending in `.png`; the story id is
// the basename without extension. Renames are treated as a remove of the
// old path plus an add of the new one — defensive, since the screenshot
// pipeline overwrites in place and shouldn't emit renames, but a story id
// change would otherwise be invisible.
export function classifyScreenshotChanges(nameStatus) {
	const added = [];
	const modified = [];
	const removed = [];
	const idOf = (p) => {
		const base = path.basename(p.trim());
		return base.endsWith(".png") ? base.slice(0, -4) : null;
	};
	for (const raw of (nameStatus || "").split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const parts = line.split("\t");
		const status = parts[0]?.[0];
		if (status === "A") {
			const id = idOf(parts[1] || "");
			if (id) added.push(id);
		} else if (status === "M") {
			const id = idOf(parts[1] || "");
			if (id) modified.push(id);
		} else if (status === "D") {
			const id = idOf(parts[1] || "");
			if (id) removed.push(id);
		} else if (status === "R") {
			// `R100\told\tnew`
			const oldId = idOf(parts[1] || "");
			const newId = idOf(parts[2] || "");
			if (oldId) removed.push(oldId);
			if (newId) added.push(newId);
		}
	}
	return {
		added: [...new Set(added)].sort(),
		modified: [...new Set(modified)].sort(),
		removed: [...new Set(removed)].sort(),
	};
}

// Build a lookup of story id -> { title, name, file } from the
// changed-stories payload so we can label ids with something readable.
// Unknown ids fall back to the bare id.
function buildLookup(stories) {
	const map = new Map();
	for (const s of stories || []) {
		map.set(s.id, { title: s.title, name: s.name, file: s.file });
	}
	return map;
}

// Pure helper: render the sticky-comment markdown from the classified
// changes. Exported so the unit test can exercise grouping / thumbnail /
// empty-state behavior without touching git or the filesystem.
export function renderComment({
	changes,
	repo,
	prNumber,
	ref = "",
	stories = [],
	// Predicate for whether a thumbnail should be embedded for an id.
	// Defaults to "yes when we have a ref to point at" — the committed PNG
	// is reachable on the PR branch at that SHA via raw.githubusercontent.
	showThumbnail = (_id) => Boolean(ref),
}) {
	const lookup = buildLookup(stories);
	const { added, modified, removed } = changes;
	const total = added.length + modified.length + removed.length;
	const lines = ["## 📸 PR screenshots", ""];

	if (total === 0) {
		lines.push("_No story screenshots changed in this PR._");
		return `${lines.join("\n")}\n`;
	}

	const filesUrl = `https://github.com/${repo}/pull/${prNumber}/files`;
	const summaryBits = [];
	if (modified.length) summaryBits.push(`${modified.length} changed`);
	if (added.length) summaryBits.push(`${added.length} new`);
	if (removed.length) summaryBits.push(`${removed.length} removed`);
	lines.push(
		`${summaryBits.join(" · ")}. Open the [**Files changed**](${filesUrl}) tab for GitHub's side-by-side / swipe / onion-skin image diff.`,
	);
	lines.push("");

	const label = (id) => {
		const meta = lookup.get(id);
		return meta ? `${meta.title} — ${meta.name}` : id;
	};
	const thumb = (id) => {
		if (!ref || !showThumbnail(id)) return "";
		const url = `https://raw.githubusercontent.com/${repo}/${ref}/screenshots/${id}.png`;
		return `\n\n[![${label(id)}](${url})](${url})`;
	};

	const section = (heading, ids, withThumb) => {
		if (!ids.length) return;
		lines.push(`### ${heading}`);
		for (const id of ids) {
			lines.push(`- **${label(id)}** \`${id}\`${withThumb ? thumb(id) : ""}`);
		}
		lines.push("");
	};

	section("Changed", modified, true);
	section("New", added, true);
	section("Removed", removed, false);

	if (ref) {
		lines.push(`<sub>baselines @ ${ref.slice(0, 7)}</sub>`);
	}

	return `${lines.join("\n")}\n`;
}

const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]).endsWith("build-pr-screenshot-comment.mjs");

if (invokedDirectly) {
	const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
	const prNumber = process.env.PR_NUMBER;
	const ref = process.env.SCREENSHOT_REF || "";

	const nameStatusPath = process.argv[2];
	const changedStoriesPath = process.argv[3];
	const outPath = process.argv[4];

	if (!repo || !prNumber || !nameStatusPath) {
		process.stderr.write(
			"usage: REPO=… PR_NUMBER=… [SCREENSHOT_REF=…] build-pr-screenshot-comment.mjs <name-status.txt> [changed-stories.json] [out.md]\n",
		);
		process.exit(2);
	}

	const nameStatus = readFileSync(nameStatusPath, "utf8");
	const changes = classifyScreenshotChanges(nameStatus);
	let stories = [];
	if (changedStoriesPath) {
		try {
			stories = JSON.parse(readFileSync(changedStoriesPath, "utf8")).stories || [];
		} catch {
			stories = [];
		}
	}

	const body = renderComment({ changes, repo, prNumber, ref, stories });

	if (outPath) {
		writeFileSync(outPath, body);
	} else {
		process.stdout.write(body);
	}
}

#!/usr/bin/env node
// Reconcile freshly-rendered Storybook screenshots against the committed
// `screenshots/<id>.png` visual-regression baselines.
//
// Why this exists: headless Chromium never renders byte-identically twice —
// two passes of the same story wobble by a handful of antialiasing pixels
// (sometimes a single pixel). A plain `git diff` treats those as changes
// and would commit visually-identical noise on every PR. So instead of
// overwriting baselines blindly, we pixel-compare each render to its
// baseline (pixelmatch with antialiasing detection) and only replace a
// baseline when the difference clears a small threshold. New stories are
// added, deleted stories are removed; everything else is left untouched so
// git — and the PR's "Files changed" diff — only ever shows real changes.
import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// A render must differ by MORE than this many (non-antialiased) pixels to
// count as a real change. Calibrated against back-to-back CI renders: the
// antialiasing residue sits in the low tens, genuine content changes are
// orders of magnitude larger. Override with $SCREENSHOT_MAX_DIFF_PIXELS.
export const DEFAULT_MAX_DIFF_PIXELS = 80;
// pixelmatch per-pixel colour sensitivity (0 strict … 1 lax).
export const DEFAULT_THRESHOLD = 0.1;

const isPng = (f) => f.endsWith(".png");
const idOf = (f) => f.slice(0, -4);

// Count meaningfully-different pixels between two PNG buffers, discounting
// antialiased edges (`includeAA: false`). Returns Infinity when dimensions
// differ — a resized story is unambiguously a change.
export function diffPixelCount(bufA, bufB, { threshold = DEFAULT_THRESHOLD } = {}) {
	const a = PNG.sync.read(bufA);
	const b = PNG.sync.read(bufB);
	if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
	return pixelmatch(a.data, b.data, null, a.width, a.height, {
		threshold,
		includeAA: false,
	});
}

// Compare renderedDir against baselineDir and, when `apply`, update the
// baselines in place (overwrite changed, add new, drop deleted). Returns
// { added, modified, removed } story-id lists for the PR comment.
//
// `knownIds` (when given) is the set of story ids that still exist in the
// Storybook index. A baseline whose render is missing is only deleted when
// its story id is *not* in that set — otherwise the render merely failed
// this run (test-storybook tolerates per-story errors) and we must keep the
// existing baseline rather than silently dropping it.
export function reconcileBaselines({
	renderedDir,
	baselineDir,
	maxDiffPixels = DEFAULT_MAX_DIFF_PIXELS,
	threshold = DEFAULT_THRESHOLD,
	knownIds = null,
	apply = true,
}) {
	mkdirSync(baselineDir, { recursive: true });
	const rendered = readdirSync(renderedDir).filter(isPng);
	const baseline = new Set(readdirSync(baselineDir).filter(isPng));
	const added = [];
	const modified = [];
	const removed = [];

	for (const file of rendered) {
		const rPath = path.join(renderedDir, file);
		const bPath = path.join(baselineDir, file);
		if (!baseline.has(file)) {
			added.push(idOf(file));
			if (apply) copyFileSync(rPath, bPath);
			continue;
		}
		baseline.delete(file); // mark as seen
		const diff = diffPixelCount(readFileSync(rPath), readFileSync(bPath), { threshold });
		if (diff > maxDiffPixels) {
			modified.push(idOf(file));
			if (apply) copyFileSync(rPath, bPath);
		}
	}

	for (const file of baseline) {
		const id = idOf(file);
		// Render missing but the story still exists -> transient render
		// failure, keep the baseline.
		if (knownIds && knownIds.has(id)) continue;
		removed.push(id);
		if (apply) rmSync(path.join(baselineDir, file));
	}

	return {
		added: added.sort(),
		modified: modified.sort(),
		removed: removed.sort(),
	};
}

const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]).endsWith("compare-screenshots.mjs");

if (invokedDirectly) {
	const renderedDir = process.argv[2];
	const baselineDir = process.argv[3];
	const jsonOut = process.argv[4];
	if (!renderedDir || !baselineDir) {
		process.stderr.write(
			"usage: [SCREENSHOT_MAX_DIFF_PIXELS=…] [STORYBOOK_INDEX=…] compare-screenshots.mjs <rendered-dir> <baseline-dir> [changes.json]\n",
		);
		process.exit(2);
	}

	let knownIds = null;
	const indexPath = process.env.STORYBOOK_INDEX;
	if (indexPath) {
		try {
			const index = JSON.parse(readFileSync(indexPath, "utf8"));
			knownIds = new Set(
				Object.values(index.entries || {})
					.filter((e) => e.type === "story")
					.map((e) => e.id),
			);
		} catch {
			knownIds = null;
		}
	}

	const maxDiffPixels = Number(process.env.SCREENSHOT_MAX_DIFF_PIXELS ?? DEFAULT_MAX_DIFF_PIXELS);
	const changes = reconcileBaselines({
		renderedDir,
		baselineDir,
		maxDiffPixels,
		knownIds,
		apply: true,
	});

	const total = changes.added.length + changes.modified.length + changes.removed.length;
	process.stdout.write(
		`baselines: ${changes.modified.length} changed, ${changes.added.length} added, ${changes.removed.length} removed\n`,
	);
	if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(changes, null, 2)}\n`);
	// Surface the change count for the workflow (skip a commit when zero).
	if (process.env.GITHUB_OUTPUT) {
		writeFileSync(process.env.GITHUB_OUTPUT, `changed_count=${total}\n`, { flag: "a" });
	}
}

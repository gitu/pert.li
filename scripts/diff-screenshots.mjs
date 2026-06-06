#!/usr/bin/env node
// Pixel-diff a directory of freshly-rendered storybook screenshots against a
// baseline directory, and classify each story as changed / new / removed /
// unchanged. This is what turns the screenshot pipeline into a real visual
// regression check: instead of "show every story whose source file changed",
// we render everything and surface only the stories that actually *look*
// different from `main`'s baseline.
//
// Tolerance is deliberate. Small per-pixel noise (anti-aliasing, sub-pixel
// font hinting) should NOT flag a story. A story counts as `changed` only when
// the heuristic says so: pixelmatch finds at least MIN_PIXELS mismatched
// pixels AND the mismatch ratio clears MISMATCH_RATIO. Knobs below are env-
// overridable so the threshold can be tuned without a code change.
//
// Both inputs are `<story-id>.png` files (produced by .storybook/test-runner.ts
// when STORYBOOK_SCREENSHOT_DIR is set). Story metadata (title / name /
// importPath) is read from storybook's `index.json` so the PR comment can keep
// grouping by component title and show the source-file subtitle.
//
// Usage:
//   node scripts/diff-screenshots.mjs <baselineDir> <currentDir> <indexJson> <diffOutDir> <outJson>
//
// Output JSON shape:
//   { stories: [{ id, title, name, file, status, mismatch?, ratio? }], counts: {...} }
// where status ∈ "changed" | "new" | "removed" (unchanged stories are omitted).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// pixelmatch per-pixel color-distance tolerance (0..1). 0.1 ignores the
// anti-aliasing / sub-pixel jitter that the same Chromium build still
// produces run-to-run while staying sensitive to real color/layout changes.
const DIFF_THRESHOLD = numEnv("SCREENSHOT_DIFF_THRESHOLD", 0.1);
// Fraction of the image's pixels that must differ before we call it a change.
// 0.002 = 0.2%. Below this, a story is treated as unchanged regardless of
// MIN_PIXELS — keeps a stray cursor/caret or one re-hinted glyph from flagging
// an otherwise-identical render.
const MISMATCH_RATIO = numEnv("SCREENSHOT_DIFF_RATIO", 0.002);
// Absolute floor on mismatched pixels. On a tiny clipped screenshot (a button,
// an avatar) 0.2% can be just a handful of pixels; require a real count too so
// noise on small images doesn't trip the ratio.
const MIN_PIXELS = numEnv("SCREENSHOT_DIFF_MIN_PIXELS", 50);
// Stories carrying this Storybook tag are excluded from pixel diffing entirely.
// Some renders are legitimately non-deterministic across builds — the xyflow /
// elkjs canvas re-lays-out its whole graph, and a few stories surface a freshly
// generated id — so pixel-diffing them produces noise, not signal. They still
// run as functional tests in the `storybook` test-runner job; they're just not
// visually compared. The set of ignored stories is logged so the exclusion is
// never silent. Tag a story (or its meta) with `no-screenshot-diff` to opt out.
const IGNORE_TAG = process.env.SCREENSHOT_DIFF_IGNORE_TAG || "no-screenshot-diff";

function numEnv(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

// Pure decision helper — given the comparison facts, return the story status.
// Exported so the unit test can pin the heuristic boundaries without rendering
// or reading any PNGs. `opts` lets tests override the thresholds; production
// callers use the module-level defaults.
export function classifyDiff(
	{ hasBaseline, hasCurrent, dimsDiffer, mismatched, total },
	opts = {},
) {
	const ratioFloor = opts.ratio ?? MISMATCH_RATIO;
	const minPixels = opts.minPixels ?? MIN_PIXELS;

	if (!hasCurrent) return "removed";
	if (!hasBaseline) return "new";
	// Images of different sizes can't be pixel-compared, and a bare dimension
	// change on its own isn't a regression we act on — we only care about
	// actual image (pixel) comparisons. Treat it as unchanged; the caller still
	// tracks + logs it (see diffScreenshots) so the skip is never silent.
	if (dimsDiffer) return "unchanged";
	const ratio = total > 0 ? mismatched / total : 0;
	if (mismatched >= minPixels && ratio >= ratioFloor) return "changed";
	return "unchanged";
}

// Build id -> { title, name, file } from storybook's index.json. `file` is the
// importPath normalized to a repo-root-relative path (drops the leading "./").
function readStoryMeta(indexPath) {
	const meta = new Map();
	if (!indexPath || !existsSync(indexPath)) return meta;
	const index = JSON.parse(readFileSync(indexPath, "utf8"));
	for (const entry of Object.values(index?.entries ?? {})) {
		if (!entry || entry.type === "docs") continue;
		meta.set(entry.id, {
			title: entry.title,
			name: entry.name,
			file: path.normalize(String(entry.importPath ?? "").replace(/^\.\//, "")),
			tags: Array.isArray(entry.tags) ? entry.tags : [],
		});
	}
	return meta;
}

function listPngIds(dir) {
	if (!dir || !existsSync(dir)) return new Set();
	return new Set(
		readdirSync(dir)
			.filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"))
			.map((f) => f.slice(0, -".png".length)),
	);
}

// Compare one story's two PNGs. Returns the facts classifyDiff needs, plus a
// `diff` PNG buffer (the highlighted overlay) when dimensions match — the
// caller decides whether to write it, since only `changed` stories keep it.
function compareStory(id, baselineDir, currentDir) {
	const baseImg = PNG.sync.read(readFileSync(path.join(baselineDir, `${id}.png`)));
	const curImg = PNG.sync.read(readFileSync(path.join(currentDir, `${id}.png`)));
	const dimsDiffer =
		baseImg.width !== curImg.width || baseImg.height !== curImg.height;
	if (dimsDiffer) {
		return { dimsDiffer: true, mismatched: 0, total: 0 };
	}
	const { width, height } = curImg;
	const total = width * height;
	const diff = new PNG({ width, height });
	const mismatched = pixelmatch(baseImg.data, curImg.data, diff.data, width, height, {
		threshold: DIFF_THRESHOLD,
		includeAA: false,
	});
	return { dimsDiffer: false, mismatched, total, diff };
}

export function diffScreenshots({ baselineDir, currentDir, indexPath, diffOutDir }) {
	const meta = readStoryMeta(indexPath);
	const baseIds = listPngIds(baselineDir);
	const curIds = listPngIds(currentDir);
	if (diffOutDir) mkdirSync(diffOutDir, { recursive: true });

	const allIds = new Set([...baseIds, ...curIds]);
	const stories = [];
	const ignored = [];
	const sized = [];
	const counts = { changed: 0, new: 0, removed: 0, unchanged: 0, size: 0, ignored: 0 };

	for (const id of [...allIds].sort()) {
		// Opt-out tag: skip non-deterministic stories before doing any work.
		if ((meta.get(id)?.tags ?? []).includes(IGNORE_TAG)) {
			ignored.push(id);
			counts.ignored++;
			continue;
		}

		const hasBaseline = baseIds.has(id);
		const hasCurrent = curIds.has(id);

		let facts = { hasBaseline, hasCurrent, dimsDiffer: false, mismatched: 0, total: 0 };
		let diffPng;
		if (hasBaseline && hasCurrent) {
			const cmp = compareStory(id, baselineDir, currentDir);
			facts = { ...facts, ...cmp };
			diffPng = cmp.diff;
		}

		const status = classifyDiff(facts);
		// A bare dimension change classifies as unchanged — we only flag real
		// pixel comparisons — but track it separately and log it (never silent)
		// so a reviewer can tell a story resized without us treating it as a
		// regression. It's deliberately kept out of the PR comment.
		if (status === "unchanged" && facts.dimsDiffer) {
			counts.size++;
			sized.push(id);
			continue;
		}
		if (status === "unchanged") {
			counts.unchanged++;
			continue;
		}
		counts[status]++;

		// Write the diff overlay only when we have a real pixel diff (a
		// `changed` story always has equal dimensions now). New / removed
		// stories have no overlay; the comment renders them accordingly.
		if (status === "changed" && diffOutDir && diffPng) {
			writeFileSync(path.join(diffOutDir, `${id}.diff.png`), PNG.sync.write(diffPng));
		}

		const info = meta.get(id) ?? { title: id, name: id, file: "" };
		stories.push({
			id,
			title: info.title,
			name: info.name,
			file: info.file,
			status,
			mismatch: facts.mismatched,
			ratio: facts.total > 0 ? facts.mismatched / facts.total : 0,
		});
	}

	return { stories, ignored, sized, counts };
}

const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]).endsWith("diff-screenshots.mjs");

if (invokedDirectly) {
	const [baselineDir, currentDir, indexPath, diffOutDir, outJson] = process.argv.slice(2);
	if (!baselineDir || !currentDir) {
		process.stderr.write(
			"usage: diff-screenshots.mjs <baselineDir> <currentDir> [indexJson] [diffOutDir] [outJson]\n",
		);
		process.exit(2);
	}
	const result = diffScreenshots({ baselineDir, currentDir, indexPath, diffOutDir });
	const json = JSON.stringify(result, null, 2);
	if (outJson) {
		writeFileSync(outJson, json);
	} else {
		process.stdout.write(`${json}\n`);
	}
	const c = result.counts;
	process.stderr.write(
		`diff-screenshots: ${c.changed} changed, ${c.new} new, ${c.removed} removed, ${c.size} resized, ${c.unchanged} unchanged, ${c.ignored} ignored\n`,
	);
	if (result.ignored.length) {
		// Never silent: name every story excluded from the visual diff so a
		// reviewer can tell coverage was skipped (not that nothing changed).
		process.stderr.write(
			`diff-screenshots: ignored via \`${IGNORE_TAG}\` tag: ${result.ignored.join(", ")}\n`,
		);
	}
	if (result.sized.length) {
		// Same principle for dimension-only changes: not flagged as regressions,
		// but named so a reviewer knows a story's render resized.
		process.stderr.write(
			`diff-screenshots: dimension-only change (not flagged): ${result.sized.join(", ")}\n`,
		);
	}
}

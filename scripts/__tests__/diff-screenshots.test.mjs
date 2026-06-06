import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyDiff, diffScreenshots } from "../diff-screenshots.mjs";

describe("classifyDiff (heuristic boundaries)", () => {
	const opts = { ratio: 0.002, minPixels: 50 };
	const facts = (over = {}) => ({
		hasBaseline: true,
		hasCurrent: true,
		dimsDiffer: false,
		mismatched: 0,
		total: 10000,
		...over,
	});

	it("is `new` when there is no baseline", () => {
		expect(classifyDiff(facts({ hasBaseline: false }), opts)).toBe("new");
	});

	it("is `removed` when the current render is gone", () => {
		expect(classifyDiff(facts({ hasCurrent: false }), opts)).toBe("removed");
	});

	it("is `changed` when dimensions differ regardless of pixel counts", () => {
		expect(classifyDiff(facts({ dimsDiffer: true }), opts)).toBe("changed");
	});

	it("is `unchanged` below the ratio floor (lots of pixels, but <0.2%)", () => {
		// 10 of 10000 px = 0.1% < 0.2% → tolerated even though >= minPixels.
		expect(classifyDiff(facts({ mismatched: 10 }), opts)).toBe("unchanged");
	});

	it("is `unchanged` above the ratio floor but below the min-pixel floor", () => {
		// 40 of 1000 px = 4% (clears ratio) but only 40 px < 50 → tolerated.
		// Guards tiny clipped screenshots from flapping on a few pixels.
		expect(classifyDiff(facts({ mismatched: 40, total: 1000 }), opts)).toBe("unchanged");
	});

	it("is `changed` only when BOTH floors are cleared", () => {
		// 100 of 10000 px = 1% and >= 50 px.
		expect(classifyDiff(facts({ mismatched: 100 }), opts)).toBe("changed");
	});
});

// Build a solid-color RGBA PNG buffer of the given size.
function solidPng(width, height, [r, g, b]) {
	const png = new PNG({ width, height });
	for (let i = 0; i < width * height; i++) {
		const o = i * 4;
		png.data[o] = r;
		png.data[o + 1] = g;
		png.data[o + 2] = b;
		png.data[o + 3] = 255;
	}
	return PNG.sync.write(png);
}

describe("diffScreenshots (real pixelmatch pipeline)", () => {
	let dir;
	let baselineDir;
	let currentDir;
	let diffDir;

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "diff-screenshots-"));
		baselineDir = path.join(dir, "base");
		currentDir = path.join(dir, "cur");
		diffDir = path.join(dir, "diff");
		mkdirSync(baselineDir, { recursive: true });
		mkdirSync(currentDir, { recursive: true });
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("flags only the story whose pixels actually changed", () => {
		// identical-story: same red image on both sides → unchanged.
		writeFileSync(path.join(baselineDir, "comp--same.png"), solidPng(100, 100, [255, 0, 0]));
		writeFileSync(path.join(currentDir, "comp--same.png"), solidPng(100, 100, [255, 0, 0]));
		// changed-story: red baseline vs blue current → fully different.
		writeFileSync(path.join(baselineDir, "comp--diff.png"), solidPng(100, 100, [255, 0, 0]));
		writeFileSync(path.join(currentDir, "comp--diff.png"), solidPng(100, 100, [0, 0, 255]));

		const { stories, counts } = diffScreenshots({
			baselineDir,
			currentDir,
			indexPath: undefined,
			diffOutDir: diffDir,
		});

		const ids = stories.map((s) => s.id);
		expect(ids).toEqual(["comp--diff"]);
		expect(stories[0].status).toBe("changed");
		expect(counts.unchanged).toBe(1);
		expect(counts.changed).toBe(1);
		// A diff overlay was written for the changed story.
		expect(readdirSync(diffDir)).toContain("comp--diff.diff.png");
	});

	it("skips stories tagged no-screenshot-diff and reports them as ignored", () => {
		// A tagged story that DID change visually must still be excluded.
		writeFileSync(path.join(baselineDir, "comp--flappy.png"), solidPng(100, 100, [255, 0, 0]));
		writeFileSync(path.join(currentDir, "comp--flappy.png"), solidPng(100, 100, [0, 0, 255]));
		// An untagged story that changed must still be flagged.
		writeFileSync(path.join(baselineDir, "comp--real.png"), solidPng(100, 100, [255, 0, 0]));
		writeFileSync(path.join(currentDir, "comp--real.png"), solidPng(100, 100, [0, 0, 255]));

		const indexPath = path.join(dir, "index.json");
		writeFileSync(
			indexPath,
			JSON.stringify({
				v: 5,
				entries: {
					"comp--flappy": {
						id: "comp--flappy",
						title: "Comp",
						name: "Flappy",
						importPath: "./src/comp.stories.tsx",
						type: "story",
						tags: ["play-fn", "no-screenshot-diff"],
					},
					"comp--real": {
						id: "comp--real",
						title: "Comp",
						name: "Real",
						importPath: "./src/comp.stories.tsx",
						type: "story",
						tags: ["play-fn"],
					},
				},
			}),
		);

		const { stories, ignored, counts } = diffScreenshots({
			baselineDir,
			currentDir,
			indexPath,
			diffOutDir: diffDir,
		});
		expect(ignored).toEqual(["comp--flappy"]);
		expect(counts.ignored).toBe(1);
		expect(stories.map((s) => s.id)).toEqual(["comp--real"]);
		// No overlay written for the ignored story.
		expect(readdirSync(diffDir)).not.toContain("comp--flappy.diff.png");
	});

	it("classifies new, removed, and size-changed stories", () => {
		// only-in-current → new
		writeFileSync(path.join(currentDir, "comp--fresh.png"), solidPng(50, 50, [0, 255, 0]));
		// only-in-baseline → removed
		writeFileSync(path.join(baselineDir, "comp--old.png"), solidPng(50, 50, [0, 255, 0]));
		// different dimensions → changed (size)
		writeFileSync(path.join(baselineDir, "comp--resize.png"), solidPng(50, 50, [0, 255, 0]));
		writeFileSync(path.join(currentDir, "comp--resize.png"), solidPng(80, 50, [0, 255, 0]));

		const { stories } = diffScreenshots({
			baselineDir,
			currentDir,
			indexPath: undefined,
			diffOutDir: diffDir,
		});
		const byId = Object.fromEntries(stories.map((s) => [s.id, s]));
		expect(byId["comp--fresh"].status).toBe("new");
		expect(byId["comp--old"].status).toBe("removed");
		expect(byId["comp--resize"].status).toBe("changed");
		expect(byId["comp--resize"].sizeChanged).toBe(true);
		// No overlay for a size change (can't pixelmatch unequal dims).
		expect(readdirSync(diffDir)).not.toContain("comp--resize.diff.png");
	});
});

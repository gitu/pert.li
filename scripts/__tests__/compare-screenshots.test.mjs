import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { diffPixelCount, reconcileBaselines } from "../compare-screenshots.mjs";

// Build a solid-fill PNG buffer.
function solid(w, h, [r, g, b, a] = [0, 0, 0, 255]) {
	const png = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		const o = i * 4;
		png.data[o] = r;
		png.data[o + 1] = g;
		png.data[o + 2] = b;
		png.data[o + 3] = a;
	}
	return PNG.sync.write(png);
}

// Copy a PNG buffer and paint a w×h white block at (x, y) — a chunky,
// non-antialiased change so pixelmatch counts it whole.
function withBlock(buf, x, y, bw, bh) {
	const png = PNG.sync.read(buf);
	for (let dy = 0; dy < bh; dy++) {
		for (let dx = 0; dx < bw; dx++) {
			const o = ((y + dy) * png.width + (x + dx)) * 4;
			png.data[o] = 255;
			png.data[o + 1] = 255;
			png.data[o + 2] = 255;
			png.data[o + 3] = 255;
		}
	}
	return PNG.sync.write(png);
}

describe("diffPixelCount", () => {
	it("is 0 for identical images", () => {
		const a = solid(40, 40);
		expect(diffPixelCount(a, a)).toBe(0);
	});

	it("returns Infinity when dimensions differ", () => {
		expect(diffPixelCount(solid(40, 40), solid(40, 41))).toBe(Number.POSITIVE_INFINITY);
	});

	it("counts a chunky block change", () => {
		const base = solid(100, 100);
		const changed = withBlock(base, 10, 10, 20, 20);
		// ~400px block; antialiasing detection may shave the border, but it
		// is unambiguously in the hundreds.
		expect(diffPixelCount(base, changed)).toBeGreaterThan(200);
	});
});

describe("reconcileBaselines", () => {
	let dir;
	let rendered;
	let baseline;

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "reconcile-"));
		rendered = path.join(dir, "rendered");
		baseline = path.join(dir, "screenshots");
		mkdirSync(rendered);
		mkdirSync(baseline);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const writeR = (name, buf) => writeFileSync(path.join(rendered, name), buf);
	const writeB = (name, buf) => writeFileSync(path.join(baseline, name), buf);

	it("adds a brand-new story's baseline", () => {
		writeR("foo--new.png", solid(20, 20));
		const out = reconcileBaselines({ renderedDir: rendered, baselineDir: baseline });
		expect(out.added).toEqual(["foo--new"]);
		expect(existsSync(path.join(baseline, "foo--new.png"))).toBe(true);
	});

	it("overwrites a baseline when the change clears the threshold", () => {
		const base = solid(100, 100);
		writeB("foo--default.png", base);
		writeR("foo--default.png", withBlock(base, 5, 5, 20, 20));
		const out = reconcileBaselines({
			renderedDir: rendered,
			baselineDir: baseline,
			maxDiffPixels: 80,
		});
		expect(out.modified).toEqual(["foo--default"]);
		// Baseline now holds the new render.
		expect(readFileSync(path.join(baseline, "foo--default.png")).length).toBe(
			readFileSync(path.join(rendered, "foo--default.png")).length,
		);
	});

	it("leaves a sub-threshold (antialiasing-scale) render untouched", () => {
		const base = solid(100, 100);
		writeB("foo--default.png", base);
		// A 2×2 white speck — 4px, well under the threshold.
		writeR("foo--default.png", withBlock(base, 50, 50, 2, 2));
		const before = readFileSync(path.join(baseline, "foo--default.png"));
		const out = reconcileBaselines({
			renderedDir: rendered,
			baselineDir: baseline,
			maxDiffPixels: 80,
		});
		expect(out.modified).toEqual([]);
		// Baseline byte-for-byte unchanged — no noisy commit.
		expect(readFileSync(path.join(baseline, "foo--default.png"))).toEqual(before);
	});

	it("removes a baseline whose story no longer exists", () => {
		writeB("gone--story.png", solid(20, 20));
		writeR("kept--story.png", solid(20, 20));
		const out = reconcileBaselines({
			renderedDir: rendered,
			baselineDir: baseline,
			knownIds: new Set(["kept--story"]),
		});
		expect(out.removed).toEqual(["gone--story"]);
		expect(existsSync(path.join(baseline, "gone--story.png"))).toBe(false);
	});

	it("keeps a baseline whose story still exists but failed to render", () => {
		// In the index, but no rendered PNG this run -> transient failure.
		writeB("flaky--story.png", solid(20, 20));
		const out = reconcileBaselines({
			renderedDir: rendered,
			baselineDir: baseline,
			knownIds: new Set(["flaky--story"]),
		});
		expect(out.removed).toEqual([]);
		expect(existsSync(path.join(baseline, "flaky--story.png"))).toBe(true);
	});
});

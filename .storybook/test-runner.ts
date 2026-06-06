import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TestRunnerConfig } from "@storybook/test-runner";

// When `STORYBOOK_SCREENSHOT_DIR` is set (only the `pr-screenshots` CI job
// does this), drop a PNG per story into that directory keyed by story id
// (e.g. `pert-canvas--default.png` — storybook IDs are kebab-case with `--`
// separating component and variant, both filesystem-safe). The PR workflow
// reconciles those renders against the committed `screenshots/<id>.png`
// visual-regression baselines and auto-commits any real changes.
const SCREENSHOT_DIR = process.env.STORYBOOK_SCREENSHOT_DIR;
if (SCREENSHOT_DIR) {
	mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Browser-side determinism shim, injected before each story renders during
// the screenshot run. Committed baselines only work if a story renders the
// same bytes every time, so we neutralize the two wall-clock/entropy sources
// that otherwise drift between back-to-back renders:
//   • the clock — relative "Xs ago" timestamps and any bare `new Date()`;
//   • crypto.getRandomValues — generated ids (e.g. proposal id remaps).
// Serialized and run via page.addInitScript, so it must be self-contained.
function deterministicShim() {
	const FIXED = 1735732800000; // 2025-01-01T12:00:00.000Z
	const RealDate = Date;
	class FrozenDate extends RealDate {
		constructor(...args: unknown[]) {
			if (args.length === 0) {
				super(FIXED);
			} else {
				// @ts-expect-error forward whatever Date args were passed
				super(...args);
			}
		}
		static now() {
			return FIXED;
		}
	}
	// @ts-expect-error replace the global Date with the frozen variant
	globalThis.Date = FrozenDate;

	// xorshift32 PRNG — deterministic, no external state.
	let seed = 0x2545f491;
	const next = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return seed >>> 0;
	};
	const cryptoObj = globalThis.crypto;
	if (cryptoObj?.getRandomValues) {
		cryptoObj.getRandomValues = (arr: ArrayBufferView) => {
			const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
			for (let i = 0; i < view.length; i++) view[i] = next() & 0xff;
			return arr as never;
		};
	}
}

// Track which pages already have the shim installed. `addInitScript`
// persists across the test-runner's per-story navigations, so we only need
// to inject + reload once per worker page; the first story on a page was
// loaded before we got a hook, so it needs the reload to pick the shim up.
const shimmedPages = new WeakSet<object>();

// Breathing room around the content bounding box so clipped screenshots
// don't sit flush against the image edge.
const CLIP_PADDING = 16;
// Skip clipping when content already covers (almost) the whole viewport —
// full-bleed stories like canvas/timeline gain nothing from it.
const FULL_BLEED_RATIO = 0.95;
// Guard against degenerate boxes (a story whose visible content is tiny or
// empty) — fall back to the plain viewport screenshot instead.
const MIN_CLIP_SIZE = 24;

type Box = { left: number; top: number; right: number; bottom: number };

const config: TestRunnerConfig = {
	async preVisit(page) {
		if (!SCREENSHOT_DIR) return;
		if (shimmedPages.has(page)) return;
		shimmedPages.add(page);
		// Applies to every subsequent navigation; reload so it also takes
		// effect for the story already on screen.
		await page.addInitScript(deterministicShim);
		await page.reload({ waitUntil: "load" });
	},
	async postVisit(page, context) {
		if (!SCREENSHOT_DIR) return;
		const file = path.join(SCREENSHOT_DIR, `${context.id}.png`);
		try {
			// Determinism: these PNGs are committed visual-regression
			// baselines, so a render that wobbles by a pixel between runs
			// would auto-commit noise to every PR. Freeze anything that
			// animates (spinners, transitions, the text caret) and wait for
			// web fonts to finish loading before we capture — otherwise a
			// mid-transition frame or a fallback-font flash lands in the
			// baseline.
			await page.addStyleTag({
				content: `*, *::before, *::after {
					animation-duration: 0s !important;
					animation-delay: 0s !important;
					transition-duration: 0s !important;
					transition-delay: 0s !important;
					caret-color: transparent !important;
				}`,
			});
			await page.evaluate(async () => {
				await document.fonts?.ready;
			});

			// Clip the capture to the rendered content instead of the full
			// viewport — small components (buttons, cards, avatars) would
			// otherwise sit in a corner of a mostly-empty 1280×720 frame.
			// The clip box is the union of the story root's children and any
			// portal layers (Radix dialogs/popovers/tooltips mount on <body>,
			// outside #storybook-root), padded and clamped to the viewport.
			const box = await page.evaluate<Box | null>(() => {
				const root = document.querySelector("#storybook-root");
				if (!root) return null;
				const candidates = [
					...Array.from(root.children),
					...Array.from(document.body.children).filter(
						(el) =>
							el !== root &&
							!["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(el.tagName),
					),
				];
				let acc: Box | null = null;
				for (const el of candidates) {
					const style = window.getComputedStyle(el);
					if (style.display === "none" || style.visibility === "hidden")
						continue;
					const r = el.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) continue;
					acc = acc
						? {
								left: Math.min(acc.left, r.left),
								top: Math.min(acc.top, r.top),
								right: Math.max(acc.right, r.right),
								bottom: Math.max(acc.bottom, r.bottom),
							}
						: { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
				}
				return acc;
			});

			const viewport = page.viewportSize();
			let clip:
				| { x: number; y: number; width: number; height: number }
				| undefined;
			if (box && viewport) {
				const x = Math.max(0, box.left - CLIP_PADDING);
				const y = Math.max(0, box.top - CLIP_PADDING);
				const right = Math.min(viewport.width, box.right + CLIP_PADDING);
				const bottom = Math.min(viewport.height, box.bottom + CLIP_PADDING);
				const width = right - x;
				const height = bottom - y;
				const fillsViewport =
					width >= viewport.width * FULL_BLEED_RATIO ||
					height >= viewport.height * FULL_BLEED_RATIO;
				if (width >= MIN_CLIP_SIZE && height >= MIN_CLIP_SIZE && !fillsViewport) {
					clip = { x, y, width, height };
				}
			}

			// Viewport-bounded screenshot (no `fullPage`) either way —
			// full-page captures of canvas/timeline stories balloon to
			// multi-MB PNGs that bloat the screenshots branch without adding
			// review signal.
			await page.screenshot({ path: file, clip });
		} catch (err) {
			// A single render-time failure shouldn't break the screenshot
			// pipeline for the other 30 stories. The PR comment builder
			// surfaces the missing file as "render failed".
			console.warn(`[screenshot] ${context.id}: ${(err as Error).message}`);
		}
	},
};

export default config;

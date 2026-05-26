import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TestRunnerConfig } from "@storybook/test-runner";

// When `STORYBOOK_SCREENSHOT_DIR` is set (only the `pr-screenshots` CI job
// does this), drop a PNG per story into that directory keyed by story id.
// The PR workflow then filters by storybook's index.json -> changed-files
// list and publishes only the matched images. Filename uses the story id
// directly (e.g. `pert-canvas--default.png`) — storybook IDs are kebab-case
// with `--` separating component and variant, both filesystem-safe.
const SCREENSHOT_DIR = process.env.STORYBOOK_SCREENSHOT_DIR;
if (SCREENSHOT_DIR) {
	mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const config: TestRunnerConfig = {
	async postVisit(page, context) {
		if (!SCREENSHOT_DIR) return;
		const file = path.join(SCREENSHOT_DIR, `${context.id}.png`);
		try {
			// Default viewport screenshot (no `fullPage`) — components are
			// sized to fit the test-runner's default viewport; full-page
			// captures of canvas/timeline stories balloon to multi-MB PNGs
			// that bloat the screenshots branch without adding review signal.
			await page.screenshot({ path: file });
		} catch (err) {
			// A single render-time failure shouldn't break the screenshot
			// pipeline for the other 30 stories. The PR comment builder
			// surfaces the missing file as "render failed".
			console.warn(`[screenshot] ${context.id}: ${(err as Error).message}`);
		}
	},
};

export default config;

// README screenshot renderer — NOT a regression test.
//
// Drives the real app (PGLite + auth via the `screenshots` Playwright project,
// see playwright.config.ts) and writes the seven 1440×900 images the README
// embeds from docs/screenshots/. Run with `pnpm screenshots`; regenerated in CI
// by .github/workflows/screenshots.yml, which commits the refreshed images back
// (onto a labelled PR's branch, or to chore/regenerate-screenshots on dispatch).
//
// These produce binary artifacts rather than assert behaviour, so they live
// outside the normal `pnpm e2e` suite (the other projects ignore this dir) and
// use plain @playwright/test — console-cleanliness gates don't apply to a
// rendering job. The view shots all run inside a single test so the freshly
// created project's in-memory Automerge doc survives across the tabs (a full
// reload would drop it while sync is disabled in e2e).

import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { COOKIE_HINT_KEY } from "../fixtures";

const OUT_DIR = "docs/screenshots";

// `animations: "disabled"` finishes in-flight CSS transitions/animations and
// freezes them, so the fit-view pan and hover states don't smear the capture.
async function shot(page: Page, name: string) {
	await page.screenshot({
		path: `${OUT_DIR}/${name}.png`,
		animations: "disabled",
	});
}

// Switch to a view tab and wait for the network canvas to finish its
// mount-time fitView before capturing. Positions are pre-laid in the sample, so
// ELK isn't invoked and the layout is deterministic. The mouse is parked off the
// canvas so no node shows a hover state in the shot.
async function showNetwork(page: Page) {
	await page.getByTestId("view-tab-network").click();
	await expect(page.locator(".react-flow__node")).toHaveCount(7, {
		timeout: 15_000,
	});
	await page.mouse.move(4, 4);
	await page.waitForTimeout(800);
}

test("render authed README screenshots", async ({ page, context }) => {
	await mkdir(OUT_DIR, { recursive: true });
	// Pre-dismiss the cookie hint so it never overlays the chrome.
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "1");
	}, COOKIE_HINT_KEY);
	// Hide the "N pending sync" topbar badge. It's a pure e2e artifact: there's
	// no sync server in this harness, so seeded/created projects never finish
	// registering and the badge sticks — it would not show in real use. Cosmetic
	// hide only, applied on every navigation.
	await context.addInitScript(() => {
		const css = '[data-testid="sync-status-trigger"]{display:none !important}';
		const add = () => {
			const s = document.createElement("style");
			s.textContent = css;
			document.head.appendChild(s);
		};
		if (document.head) add();
		else document.addEventListener("DOMContentLoaded", add);
	});

	// Empty workspace → the first visit auto-seeds exactly two sample projects:
	// "PERT tutorial" and "Monte Carlo risk sample". They land in the in-memory
	// collection immediately, so opening one via client-side nav keeps its doc
	// materialized (a full reload would drop it while sync is disabled in e2e).
	await page.goto("/");
	await expect(page.getByText("PERT tutorial").first()).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText("Monte Carlo risk sample").first()).toBeVisible({
		timeout: 15_000,
	});
	await page.waitForTimeout(300);
	await shot(page, "workspace");

	// Open the tutorial project — its 7-task critical path is the data shown in
	// every view shot. Stay on this page (client-side tab nav only) afterwards.
	await page.getByRole("link", { name: "PERT tutorial" }).first().click();
	await page.waitForURL(/\/p\/[^/]+/, { timeout: 15_000 });

	// Collapse the shell bottom panel (the empty task inspector) so the views
	// get the full canvas height — matches the README's full-bleed framing.
	await page.getByTestId("panel-toggle-bottom").click();

	// Network canvas.
	await showNetwork(page);
	await shot(page, "network");

	// Timeline / Table / Matrix — deterministic (no ELK).
	await page.getByTestId("view-tab-timeline").click();
	await expect(page.getByText("Build frontend")).toBeVisible({
		timeout: 10_000,
	});
	await page.waitForTimeout(300);
	await shot(page, "timeline");

	await page.getByTestId("view-tab-table").click();
	await expect(page.getByText("Build frontend")).toBeVisible({
		timeout: 10_000,
	});
	await page.waitForTimeout(300);
	await shot(page, "table");

	await page.getByTestId("view-tab-matrix").click();
	// Wait for the matrix to actually render (task labels fill the row headers)
	// rather than trusting a bare timeout, so a slow render can't capture a
	// partial grid.
	await expect(page.getByText("Build frontend").first()).toBeVisible({
		timeout: 10_000,
	});
	await page.waitForTimeout(300);
	await shot(page, "matrix");

	// AI co-planner — network canvas with the chat dock pinned beside it.
	await showNetwork(page);
	await page.getByTestId("topbar-chat-trigger").click();
	const pin = page.getByTestId("chat-pin-toggle");
	await expect(pin).toBeVisible({ timeout: 10_000 });
	await pin.click();
	// Pinning the chat re-expands the shell bottom panel; collapse it again so
	// the shot is a clean canvas-beside-chat layout. Only click when the panel is
	// actually expanded (button reads "Hide details panel") — that way a genuine
	// click failure still fails the run instead of being swallowed.
	const hideDetails = page.getByRole("button", { name: "Hide details panel" });
	if (await hideDetails.isVisible()) await hideDetails.click();
	await page.waitForTimeout(800);
	await shot(page, "chat");
});

test.describe("welcome", () => {
	// Unauthenticated — the marketing on-ramp at /welcome.
	test.use({ storageState: { cookies: [], origins: [] } });

	test("render the welcome screenshot", async ({ page, context }) => {
		await mkdir(OUT_DIR, { recursive: true });
		await context.addInitScript((key) => {
			window.localStorage.setItem(key, "1");
		}, COOKIE_HINT_KEY);

		await page.goto("/welcome");
		await expect(
			page.getByRole("heading", { name: "Plan something nested.", level: 1 }),
		).toBeVisible({ timeout: 10_000 });
		await page.waitForTimeout(300);
		await shot(page, "welcome");
	});
});

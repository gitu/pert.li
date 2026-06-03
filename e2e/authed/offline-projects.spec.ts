import { expect, test } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../fixtures";

// Offline-first project creation + reconnect registration.
//
// Why "server unreachable" instead of context.setOffline(true): the dev-server
// e2e rig has no service worker (the SW is only emitted by `pnpm build:pwa`),
// so a real offline state fails the route's chunk/document fetch and the page
// lands on a chrome-error screen — that path only works against a built app
// with the precaching SW. To exercise the same local-first logic here, we abort
// app server-fn fetches (keeping static assets + /api/auth) so:
//   - listProjects / getProjectById fail  → the sidebar + canvas fall back to
//     the local pending queue,
//   - registerProject fails               → the project stays queued,
// then we restore the network and assert it registers and reaches the server.
// The navigator.onLine / offline-session fallback path is covered by unit tests
// (resolveSession) and Storybook (SyncStatus).

const SERVER_UNREACHABLE = "**/*";

async function blockServerFns(page: import("@playwright/test").Page) {
	await page.route(SERVER_UNREACHABLE, (route) => {
		const req = route.request();
		const type = req.resourceType();
		// Abort data fetches (server fns) but let documents, scripts, styles, and
		// the auth session through so the SPA stays alive and signed in.
		if (
			(type === "fetch" || type === "xhr") &&
			!req.url().includes("/api/auth")
		) {
			return route.abort();
		}
		return route.continue();
	});
}

test.describe("Offline-first project creation", () => {
	test("queues a project while the server is unreachable, then registers on reconnect", async ({
		page,
		browser,
	}) => {
		await page.goto("/");
		const newProjectButton = page
			.getByRole("banner")
			.getByRole("button", { name: "New project" });
		await expect(newProjectButton).toBeVisible();

		// Warm up: one online create so the /p route chunk is loaded and the
		// workspace exists server-side.
		await newProjectButton.click();
		await page.getByLabel("Title").fill(`Warmup ${Date.now()}`);
		await page.getByRole("button", { name: "Create" }).click();
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
		await page.goto("/");
		await expect(newProjectButton).toBeVisible();

		// --- Server goes unreachable. ---
		await blockServerFns(page);

		const title = `Queued project ${Date.now()}`;
		await newProjectButton.click();
		await page.getByLabel("Title").fill(title);
		await page.getByRole("button", { name: "Create" }).click();

		// Local-first: lands on the canvas (resolved from the local queue, no
		// server round-trip) even though server fns are dead.
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

		// Shows in the sidebar immediately (merged from the local queue)…
		await expect(page.getByRole("link", { name: title }).first()).toBeVisible({
			timeout: 10_000,
		});
		// …and the sync indicator surfaces it as not-yet-synced.
		await expect(page.getByTestId("sync-status-badge")).toBeVisible({
			timeout: 10_000,
		});

		// --- Server reachable again. Nudge the reconcile loop and let it drain. ---
		await page.unroute(SERVER_UNREACHABLE);
		await page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect(page.getByTestId("sync-status-badge")).toHaveCount(0, {
			timeout: 20_000,
		});

		// Prove it reached the server: a FRESH context (same auth, empty
		// IndexedDB → no local queue) still sees the project.
		const fresh = await browser.newContext({
			storageState: STORAGE_STATE_PATH,
		});
		try {
			const freshPage = await fresh.newPage();
			await freshPage.goto("/");
			await expect(
				freshPage.getByRole("link", { name: title }).first(),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await fresh.close();
		}
	});
});

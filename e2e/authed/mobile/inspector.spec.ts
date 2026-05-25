// Phase 2: project shell on mobile mounts the MobileInspectorSheet so
// selection-driven editing works. The Automerge sync WebSocket is disabled
// in this harness (see playwright.config.ts → VITE_E2E_DISABLE_SYNC), so
// the document never materializes and we can't actually click a node. That
// branch is covered by a Storybook story; this spec just confirms the
// mobile project shell rendered the right chrome (bottom nav present,
// desktop fullscreen popup absent).

import { expect, test } from "../../console";

test("project on mobile shows bottom nav and not the desktop fullscreen header", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByTestId("mobile-topbar-menu").click();
	await page.getByRole("button", { name: "New project" }).click();

	const title = `Inspector wiring e2e ${Date.now()}`;
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	// Mobile bottom nav must be present even while the canvas waits on its
	// (disabled) sync upgrade — the shell is independent of doc readiness.
	await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();

	// The desktop fullscreen toggle lives in ProjectViewHeader, which is
	// hidden on mobile — it must not render.
	await expect(page.getByTestId("project-fullscreen")).toHaveCount(0);
});

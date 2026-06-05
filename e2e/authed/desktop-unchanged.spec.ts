// Phase 5: confirm the desktop shell is unchanged after the mobile work.
// The wide-viewport project page must still render the desktop top bar
// chrome, the sidebar collapse toggle (now on the sidebar's resize divider),
// the desktop project view tabs (Network / Timeline / Table / Matrix), and the
// fullscreen button — and must NOT render any of the mobile-only chrome.

import { expect, test } from "../console";

test("workspace home keeps the desktop top bar and sidebar", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("panel-toggle-left")).toBeVisible();
	await expect(page.getByTestId("mobile-topbar-menu")).toHaveCount(0);
	await expect(page.getByTestId("mobile-bottom-nav")).toHaveCount(0);
});

test("project page keeps the desktop view tabs and fullscreen button", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByLabel("Title").fill(`Desktop unchanged ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	await expect(page.getByTestId("view-tab-network")).toBeVisible();
	await expect(page.getByTestId("view-tab-table")).toBeVisible();
	await expect(page.getByTestId("project-fullscreen")).toBeVisible();
	await expect(page.getByTestId("mobile-topbar-edit")).toHaveCount(0);
});

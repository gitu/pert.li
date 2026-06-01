// Phase 2: chat dock on mobile. Tapping the topbar Chat icon opens the
// chat in a Sheet; the pin control must be absent because there is no
// pinned column on the mobile shell.
//
// Chat is bound to the active project, so the topbar Chat icon is hidden
// on the workspace home — the test first creates and opens a project to
// have a target plan.

import { expect, test } from "../../console";

test("topbar chat icon opens the chat sheet without a pin control", async ({
	page,
}) => {
	await page.goto("/");

	// Mobile shell has no header "New project" button — it lives inside the
	// projects sheet behind the hamburger menu.
	await page.getByTestId("mobile-topbar-menu").click();
	await page.getByRole("button", { name: "New project" }).click();
	await expect(
		page.getByRole("heading", { name: "New project" }),
	).toBeVisible();
	const title = `E2E mobile chat ${Date.now()}`;
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

	await page.getByTestId("mobile-topbar-chat").click();
	await expect(page.getByTestId("chat-panel")).toBeVisible();

	// Pin button is desktop-only — on mobile the chat has no pinned target.
	await expect(page.getByTestId("chat-pin-toggle")).toHaveCount(0);

	// Close button stays available so users have an explicit dismiss action
	// in addition to the overlay tap.
	await expect(page.getByTestId("chat-close")).toBeVisible();
});

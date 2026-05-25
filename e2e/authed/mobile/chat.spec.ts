// Phase 2: chat dock on mobile. Tapping the topbar Chat icon opens the
// chat in a Sheet; the pin control must be absent because there is no
// pinned column on the mobile shell.

import { expect, test } from "../../console";

test("topbar chat icon opens the chat sheet without a pin control", async ({
	page,
}) => {
	await page.goto("/");

	await page.getByTestId("mobile-topbar-chat").click();
	await expect(page.getByTestId("chat-panel")).toBeVisible();

	// Pin button is desktop-only — on mobile the chat has no pinned target.
	await expect(page.getByTestId("chat-pin-toggle")).toHaveCount(0);

	// Close button stays available so users have an explicit dismiss action
	// in addition to the overlay tap.
	await expect(page.getByTestId("chat-close")).toBeVisible();
});

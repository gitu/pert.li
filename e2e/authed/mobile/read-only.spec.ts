// Phase 5: the mobile shell starts in read-only mode (no inline edit
// affordances). Tapping the pencil flips to editing mode and the toast
// appears; reloading the page resets to read-only.

import { expect, test } from "../../console";

test("mobile shell starts in read-only mode and the pencil toggles it", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByTestId("mobile-topbar-menu").click();
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(`Read-only e2e ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	const toggle = page.getByTestId("mobile-topbar-edit");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(toggle).toHaveAttribute("aria-label", "Enable editing");

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(toggle).toHaveAttribute("aria-label", "Stop editing");

	// Toast on first activation.
	await expect(page.getByText(/editing enabled/i).first()).toBeVisible({
		timeout: 5_000,
	});

	// Hard reload: mode resets to read-only (sessionStorage survives a soft
	// nav but the user-facing affordance returns to its default — see the
	// ViewModeProvider hydration test). Use a fresh context-equivalent by
	// clearing sessionStorage and reloading.
	await page.evaluate(() => window.sessionStorage.clear());
	await page.reload();
	await expect(page.getByTestId("mobile-topbar-edit")).toHaveAttribute(
		"aria-pressed",
		"false",
	);
});

// Mobile parity for "account menu → About": the phone shell's overflow menu
// must expose the same About entry as the desktop account menu, so signed-in
// mobile users can reach /about. Uses the console-clean fixture.

import { expect, test } from "../../console";

test("the mobile account menu opens the about page", async ({ page }) => {
	await page.goto("/");

	// The account dropdown is the avatar button on the right (the
	// `mobile-topbar-menu` hamburger on the left is the projects sheet).
	const menu = page.getByRole("button", { name: /account menu/i });
	await expect(menu).toBeVisible({ timeout: 10_000 });
	await menu.click();

	const aboutLink = page.getByTestId("mobile-nav-about");
	await expect(aboutLink).toBeVisible();
	await aboutLink.click();

	await expect(page).toHaveURL(/\/about$/);
	await expect(
		page.getByRole("heading", { name: "About pert.li", level: 1 }),
	).toBeVisible();
});

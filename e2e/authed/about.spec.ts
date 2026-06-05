import { expect, test } from "@playwright/test";

test.describe("Account menu → About", () => {
	test("the About item opens the about page", async ({ page }) => {
		await page.goto("/");

		const accountMenu = page.getByRole("button", { name: /account menu/i });
		await expect(accountMenu).toBeVisible({ timeout: 15_000 });
		await accountMenu.click();

		const aboutLink = page.getByTestId("topbar-nav-about");
		await expect(aboutLink).toBeVisible();
		await aboutLink.click();

		await expect(page).toHaveURL(/\/about$/);
		await expect(
			page.getByRole("heading", { name: "About pert.li", level: 1 }),
		).toBeVisible();
	});
});

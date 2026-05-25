import { expect, test } from "@playwright/test";

test.describe("/privacy", () => {
	test("renders the default policy", async ({ page }) => {
		await page.goto("/privacy");
		await expect(
			page.getByRole("heading", { name: "Privacy policy", level: 1 }),
		).toBeVisible();
		// Spot-check the load-bearing claims so the test fails if a future edit
		// drops them by accident.
		await expect(
			page.getByRole("heading", { name: "No tracking" }),
		).toBeVisible();
		await expect(page.getByRole("heading", { name: "Cookies" })).toBeVisible();
		await expect(page.getByText(/no analytics.*no advertising/i)).toBeVisible();
	});

	test("links back to the home page", async ({ page }) => {
		await page.goto("/privacy");
		await page.getByRole("link", { name: /back to home/i }).click();
		await expect(page).toHaveURL(/\/$/);
	});
});

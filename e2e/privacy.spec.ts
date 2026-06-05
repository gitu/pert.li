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
		// Home is the brand lockup in the shared MarketingHeader.
		await page
			.getByRole("banner")
			.getByRole("link", { name: /pert\.li/i })
			.click();
		await expect(page).toHaveURL(/\/$/);
	});

	test("surfaces the build version in the page footer", async ({ page }) => {
		await page.goto("/privacy");
		// The exact value depends on `git describe` at build time, so we don't
		// pin it — we just confirm a non-empty version string lands in the DOM.
		const version = page.getByTestId("app-version");
		await expect(version).toBeVisible();
		await expect(version).toHaveText(/\S+/);
	});
});

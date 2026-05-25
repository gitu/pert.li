import { expect, test } from "@playwright/test";

test.describe("/welcome", () => {
	test("renders the marketing page with the hero + footer links", async ({
		page,
	}) => {
		await page.goto("/welcome");
		await expect(
			page.getByRole("heading", { name: "Plan something nested.", level: 1 }),
		).toBeVisible();
		// Footer links to both privacy and sign-in.
		await expect(
			page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }),
		).toBeVisible();
		await expect(
			page.getByRole("contentinfo").getByRole("link", { name: "Sign in" }),
		).toBeVisible();
	});

	test("Sign-in CTA goes to /signin", async ({ page }) => {
		await page.goto("/welcome");
		await page
			.getByRole("link", { name: /create your first project/i })
			.first()
			.click();
		await expect(page).toHaveURL(/\/signin$/);
	});
});

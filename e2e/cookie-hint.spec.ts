import { expect, test } from "@playwright/test";

const STORAGE_KEY = "pertli.cookieHintDismissed.v1";

test.describe("Cookie hint banner", () => {
	test("appears on first visit and links to the privacy policy", async ({
		page,
	}) => {
		await page.goto("/welcome");
		const region = page.getByRole("region", { name: "Cookie notice" });
		await expect(region).toBeVisible();
		await expect(region.getByText(/no analytics, no tracking/i)).toBeVisible();
		await expect(
			region.getByRole("link", { name: /read the privacy policy/i }),
		).toBeVisible();
	});

	test("Got it dismisses the banner and the dismissal persists across reload", async ({
		page,
	}) => {
		await page.goto("/welcome");
		const region = page.getByRole("region", { name: "Cookie notice" });
		await expect(region).toBeVisible();
		await region.getByRole("button", { name: "Got it" }).click();
		await expect(region).toHaveCount(0);

		// Storage flag is set.
		const stored = await page.evaluate(
			(k) => window.localStorage.getItem(k),
			STORAGE_KEY,
		);
		expect(stored).toBe("1");

		// Survives a reload.
		await page.reload();
		await expect(
			page.getByRole("region", { name: "Cookie notice" }),
		).toHaveCount(0);
	});

	test("does not reappear on a different route once dismissed", async ({
		page,
	}) => {
		await page.goto("/welcome");
		await page
			.getByRole("region", { name: "Cookie notice" })
			.getByRole("button", { name: "Got it" })
			.click();
		await page.goto("/signin");
		await expect(
			page.getByRole("region", { name: "Cookie notice" }),
		).toHaveCount(0);
	});
});

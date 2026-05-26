import { expect, test } from "@playwright/test";

test.describe("/admin (unauthenticated)", () => {
	test("redirects an anonymous visitor away from the admin panel", async ({
		page,
	}) => {
		// `_app` is the auth-gated shell. Hitting /admin while signed out
		// bounces through hasSeenWelcome → /welcome (or /signin), and the
		// admin route itself never renders. The contract under test is:
		// "no scenario where an unauthenticated user sees admin chrome."
		await page.goto("/admin");
		await page.waitForURL(/\/(welcome|signin)/);
		await expect(page.getByTestId("admin-panel")).toHaveCount(0);
	});
});

// Imports `test`/`expect` from the console-clean fixture so a hydration
// mismatch (the header swaps its CTAs once the live session resolves, a
// classic mismatch trap) fails these tests. Covers the signed-out state of the
// shared MarketingHeader across all three public pages that use it.

import { expect, test } from "./console";

const PUBLIC_PAGES = ["/welcome", "/about", "/privacy"] as const;

test.describe("marketing header — signed out", () => {
	for (const path of PUBLIC_PAGES) {
		test(`${path} shows the sign-in CTAs, not the signed-in shortcut`, async ({
			page,
		}) => {
			await page.goto(path);
			// Scope to the header (banner) — the footer (contentinfo) also has a
			// "Sign in" link, which would otherwise make the assertions ambiguous.
			const header = page.getByRole("banner");
			await expect(
				header.getByRole("link", { name: "Sign in", exact: true }),
			).toBeVisible();
			await expect(
				header.getByRole("link", { name: /get started/i }),
			).toBeVisible();
			await expect(
				header.getByRole("link", { name: /go to your projects/i }),
			).toHaveCount(0);
		});
	}

	test("the Get started CTA goes to /signin", async ({ page }) => {
		await page.goto("/about");
		await page
			.getByRole("banner")
			.getByRole("link", { name: /get started/i })
			.click();
		await expect(page).toHaveURL(/\/signin$/);
	});
});

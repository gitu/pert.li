import { expect, test } from "@playwright/test";

// Runs under the authenticated `storageState` project (the user from
// auth.setup.ts is already signed in). The shared MarketingHeader should drop
// the Sign in / Get started pair and offer a single shortcut back into the app
// on every public page that renders it.

const PUBLIC_PAGES = ["/welcome", "/about", "/privacy"] as const;

test.describe("marketing header — signed in", () => {
	for (const path of PUBLIC_PAGES) {
		test(`${path} swaps the sign-in CTAs for a "Go to your projects" shortcut`, async ({
			page,
		}) => {
			await page.goto(path);
			const header = page.getByRole("banner");
			const shortcut = header.getByRole("link", {
				name: /go to your projects/i,
			});
			// The swap happens once the live session resolves after hydration.
			await expect(shortcut).toBeVisible({ timeout: 15_000 });
			await expect(shortcut).toHaveAttribute("href", "/");

			// The signed-out CTAs are gone from the header.
			await expect(
				header.getByRole("link", { name: "Sign in", exact: true }),
			).toHaveCount(0);
			await expect(
				header.getByRole("link", { name: /get started/i }),
			).toHaveCount(0);
		});
	}

	test("the shortcut navigates to the projects overview", async ({ page }) => {
		await page.goto("/about");
		await page
			.getByRole("banner")
			.getByRole("link", { name: /go to your projects/i })
			.click();
		// Lands on the workspace home (the app shell), not back on a public page.
		await expect(page).toHaveURL(/\/$/);
		await expect(
			page.getByRole("button", { name: /account menu/i }),
		).toBeVisible({ timeout: 15_000 });
	});
});

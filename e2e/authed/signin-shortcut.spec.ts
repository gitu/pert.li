import { expect, test } from "@playwright/test";
import { E2E_USER } from "../fixtures";

// Runs under the authenticated `storageState` project (the user from
// auth.setup.ts is already signed in). Visiting /signin while a valid session
// is live should offer a one-click jump to the projects overview instead of
// re-presenting the sign-in form.
test.describe("/signin while already signed in", () => {
	test("offers a shortcut to the projects overview", async ({ page }) => {
		await page.goto("/signin");

		// The shortcut card replaces the form once the live session resolves.
		await expect(
			page.getByRole("heading", { name: /already signed in/i }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(E2E_USER.email)).toBeVisible();

		// The email/password form is not shown in this state.
		await expect(page.getByLabel("Password")).toHaveCount(0);

		await page
			.getByRole("button", { name: /continue to your projects/i })
			.click();

		// Lands on the workspace home (the app shell), not back on /signin.
		await expect(page).toHaveURL(/\/$/);
		await expect(
			page.getByRole("button", { name: /account menu/i }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("can fall through to the form to use a different account", async ({
		page,
	}) => {
		await page.goto("/signin");
		await expect(
			page.getByRole("heading", { name: /already signed in/i }),
		).toBeVisible({ timeout: 15_000 });

		await page
			.getByRole("button", { name: /use a different account/i })
			.click();

		// Back to the normal sign-in form.
		await expect(
			page.getByRole("heading", { name: "Sign in", exact: true }),
		).toBeVisible();
		await expect(page.getByLabel("Email")).toBeVisible();
		await expect(page.getByLabel("Password")).toBeVisible();
	});
});

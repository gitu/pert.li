import { expect, test } from "@playwright/test";
import { E2E_USER } from "../fixtures";

test.describe("/admin (signed in)", () => {
	test("the first user (auto-promoted) sees the admin overview", async ({
		page,
	}) => {
		// The e2e harness runs against a throw-away PGLite DB that's empty on
		// server start. The auth.setup spec signed up exactly one user, who
		// the user.create hook auto-promoted to admin — so the dropdown's
		// Admin link is wired and the panel server-fn authorises this caller.
		await page.goto("/");

		const accountMenu = page.getByRole("button", { name: /account menu/i });
		await expect(accountMenu).toBeVisible({ timeout: 15_000 });
		await accountMenu.click();

		const adminLink = page.getByTestId("topbar-nav-admin");
		await expect(adminLink).toBeVisible();
		await adminLink.click();

		await expect(page).toHaveURL(/\/admin$/);
		const panel = page.getByTestId("admin-panel");
		await expect(panel).toBeVisible();
		// The "Users" stat tile shows at least 1 (the auto-promoted operator).
		await expect(
			page.getByTestId("admin-stat-users").locator(".tabular-nums"),
		).toContainText(/^\d+$/);
		// And our seeded user is in the table. Scope to the panel so we don't
		// match the email rendered in the account dropdown header above it.
		await expect(panel.getByText(E2E_USER.email)).toBeVisible();
		// First user is auto-promoted to admin — the role badge confirms it.
		await expect(panel.getByText("Admin").first()).toBeVisible();
	});
});

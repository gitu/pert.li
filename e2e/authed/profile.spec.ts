import { expect, test } from "@playwright/test";
import { E2E_USER } from "../fixtures";

test.describe("Account menu → Edit profile", () => {
	test("opens the dialog pre-filled with the user's name", async ({ page }) => {
		// The "/" route mounts the app shell. We expect the workspace
		// projects query to fail (no real DB), but the topbar — including
		// the account menu and avatar — renders regardless.
		await page.goto("/");

		const accountMenu = page.getByRole("button", { name: /account menu/i });
		await expect(accountMenu).toBeVisible({ timeout: 15_000 });
		await accountMenu.click();

		await page.getByRole("menuitem", { name: /edit profile/i }).click();
		await expect(
			page.getByRole("heading", { name: /edit profile/i }),
		).toBeVisible();
		await expect(page.getByLabel("Name")).toHaveValue(E2E_USER.name);
	});

	test("saves a new display name", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("button", { name: /account menu/i }).click();
		await page.getByRole("menuitem", { name: /edit profile/i }).click();

		const newName = "Ada (renamed)";
		const nameField = page.getByLabel("Name");
		await nameField.fill(newName);
		await page.getByRole("button", { name: "Save" }).click();

		// Dialog closes on success.
		await expect(
			page.getByRole("heading", { name: /edit profile/i }),
		).toHaveCount(0);

		// Topbar reflects the new name (visible on md+ viewports — the test
		// runs in the default Desktop Chrome viewport which is wide enough).
		await expect(
			page.getByRole("button", { name: /account menu/i }),
		).toContainText(newName);
	});
});

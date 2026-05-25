import { expect, test } from "@playwright/test";

test.describe("Project creation", () => {
	test("New project → dialog → land on /p/:id with the title visible", async ({
		page,
	}) => {
		await page.goto("/");

		// Topbar "New project" button (there's also a tiny "+" in the sidebar,
		// scope by name to be unambiguous).
		await page
			.getByRole("banner")
			.getByRole("button", { name: "New project" })
			.click();

		await expect(
			page.getByRole("heading", { name: "New project" }),
		).toBeVisible();

		const title = `E2E project ${Date.now()}`;
		await page.getByLabel("Title").fill(title);
		await page.getByRole("button", { name: "Create" }).click();

		// Router lands on /p/<projectId>.
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

		// New project title surfaces somewhere on the project shell.
		await expect(page.getByText(title).first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("Created project appears in the sidebar list", async ({ page }) => {
		await page.goto("/");
		await page
			.getByRole("banner")
			.getByRole("button", { name: "New project" })
			.click();

		const title = `Sidebar test ${Date.now()}`;
		await page.getByLabel("Title").fill(title);
		await page.getByRole("button", { name: "Create" }).click();
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

		// Navigate back to the workspace home and confirm the project appears
		// in the Projects list in the sidebar.
		await page.goto("/");
		await expect(page.getByRole("link", { name: title }).first()).toBeVisible({
			timeout: 10_000,
		});
	});
});

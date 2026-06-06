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

		// Wizard step 1: pick the blank starting point to reveal the title field.
		await page.getByTestId("create-choice-empty").click();
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

		// Wizard step 1: pick the blank starting point to reveal the title field.
		await page.getByTestId("create-choice-empty").click();
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

	test("New project → Monte Carlo starting point seeds the sample plan", async ({
		page,
	}) => {
		await page.goto("/");
		await page
			.getByRole("banner")
			.getByRole("button", { name: "New project" })
			.click();

		// Pick the Monte Carlo starting point; its title pre-fills, then create.
		await page.getByTestId("create-choice-montecarlo").click();
		await page.getByRole("button", { name: "Create" }).click();
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

		// Overview is the default landing view (shows counts, not task titles);
		// switch to the network canvas via the in-app tab (client-side nav keeps
		// the freshly-seeded doc in memory) to assert a seeded task by title.
		await page.getByTestId("view-tab-network").click();

		// The sample doc's tasks land in the new project — assert one by title.
		await expect(page.getByText("Integrate vendor SDK").first()).toBeVisible({
			timeout: 10_000,
		});
	});
});

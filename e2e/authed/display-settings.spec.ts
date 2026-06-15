import { expect, type Page, test } from "@playwright/test";

// Create a fresh project from the Monte Carlo sample (which seeds tasks, so the
// Network canvas renders real nodes the display config can act on) and land on
// its Overview. Returns the project URL (/p/:id, no query).
async function createSampleProject(page: Page, label: string): Promise<string> {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByTestId("create-choice-montecarlo").click();
	// Disambiguate from other runs against a persisted DB.
	const title = `${label} ${Date.now()}`;
	const titleField = page.getByLabel("Title");
	await titleField.clear();
	await titleField.fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
	return page.url();
}

test.describe("Display settings", () => {
	test("canvas density is doc-stored and survives a reload", async ({
		page,
	}) => {
		const url = await createSampleProject(page, "Display e2e");

		// Open Display settings (collapsed by default) and switch the Network
		// nodes to the compact density, then save.
		await page.getByTestId("display-settings-toggle").click();
		await page.getByTestId("display-canvas-mode-compact").click();
		await page.getByTestId("display-save").click();
		await expect(page.getByText("Display settings saved")).toBeVisible({
			timeout: 10_000,
		});

		// The Network canvas reads the saved config: its task nodes render in the
		// compact layout.
		await page.goto(`${url}?view=network`);
		const node = page.locator('[data-testid^="task-node-"]').first();
		await expect(node).toBeVisible({ timeout: 15_000 });
		await expect(node).toHaveAttribute("data-layout", "compact");

		// Doc-stored → a hard reload of the canvas keeps it compact.
		await page.reload();
		await expect(
			page
				.locator('[data-testid^="task-node-"][data-layout="compact"]')
				.first(),
		).toBeVisible({ timeout: 15_000 });
	});

	// The cross-doc WRITE the copy performs (writeDisplay into another project's
	// handle) can't be exercised end-to-end here: the e2e server runs with
	// VITE_E2E_DISABLE_SYNC=1, so a sibling project's doc never syncs into this
	// page's repo for repo.find() to resolve. That write is covered by the
	// `writeDisplay` unit test (apply-display.test.ts) and the dialog's `onCopy`
	// Storybook assertion. Here we prove the real integration up to the dialog:
	// the container wires `listProjects` into a populated, operable picker that
	// excludes the current project.
	test("the copy dialog lists the workspace's other projects", async ({
		page,
	}) => {
		const targetTitle = `Copy target ${Date.now()}`;
		await page.goto("/");
		await page
			.getByRole("banner")
			.getByRole("button", { name: "New project" })
			.click();
		await page.getByTestId("create-choice-montecarlo").click();
		const field = page.getByLabel("Title");
		await field.clear();
		await field.fill(targetTitle);
		await page.getByRole("button", { name: "Create" }).click();
		await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });

		// A second project: the source we open the copy picker from.
		await createSampleProject(page, "Copy source");

		// Open Display settings, tweak + save, then open the copy picker.
		await page.getByTestId("display-settings-toggle").click();
		await page.getByTestId("display-overview-mode-compact").click();
		await page.getByTestId("display-save").click();
		await page.getByTestId("display-copy-open").click();

		const dialog = page.getByTestId("copy-display-dialog");
		await expect(dialog).toBeVisible();
		// The other project is listed (and the current one is not — the list
		// excludes self); select-all then enables the confirm button.
		await expect(dialog.getByText(targetTitle)).toBeVisible({
			timeout: 10_000,
		});
		const confirm = page.getByTestId("copy-display-confirm");
		await expect(confirm).toBeDisabled();
		await page.getByTestId("copy-display-select-all").check();
		await expect(confirm).toBeEnabled();
	});
});

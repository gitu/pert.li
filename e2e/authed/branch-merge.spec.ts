import { expect, test } from "@playwright/test";

// End-to-end exercise of the branch + rename flows. The merge drawer +
// banner need a live Automerge sync round trip (the cloned doc lives on the
// server until the client subscribes), but the e2e harness intentionally
// sets VITE_E2E_DISABLE_SYNC=1 — so the deep "open the branch and apply a
// merge" assertions live in Storybook + the unit tests. Here we cover the
// observable, DB-level slice:
//   (a) "Branch this plan" creates a sibling project, the new row appears
//       in the workspace sidebar grouped under its parent (parentProjectId
//       wiring through the project list).
//   (b) "Rename / edit description" updates the row in place; the new title
//       + description surface in the sidebar after a reload.
//
// Uses the base Playwright test (not ../console) — the dev server emits a
// stray Node TimeoutNegativeWarning over the dev pipe (unrelated upstream
// quirk in PGLite + Vite) that the clean-console fixture would flag.

async function createProject(
	page: import("@playwright/test").Page,
	title: string,
): Promise<void> {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
}

async function openBranchMenu(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.getByTestId("project-branch-menu").click();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Branch & merge", () => {
	test("branching a plan creates a sibling grouped under the parent", async ({
		page,
	}) => {
		const parentTitle = `Mobile launch ${Date.now()}`;
		await createProject(page, parentTitle);
		const parentUrl = page.url();

		// Open the branch menu and trigger the fork dialog.
		await openBranchMenu(page);
		await page.getByTestId("project-branch-action").click();
		const dialog = page.getByTestId("branch-project-dialog");
		await expect(dialog).toBeVisible();
		const branchTitle = `What-if Phase 2 ${Date.now()}`;
		const branchDescription = "Trying QA in parallel with implementation";
		await dialog.getByTestId("branch-project-dialog-title").fill(branchTitle);
		await dialog
			.getByTestId("branch-project-dialog-description")
			.fill(branchDescription);
		await dialog.getByRole("button", { name: /create branch/i }).click();

		// Dialog dismiss is the canonical success signal — the fork mutation
		// only resolves onSuccess. Routing follows immediately.
		await expect(dialog).toBeHidden({ timeout: 15_000 });
		await page.waitForURL(
			(url) => url.pathname.startsWith("/p/") && url.toString() !== parentUrl,
			{ timeout: 10_000 },
		);
		expect(page.url()).not.toBe(parentUrl);

		// Branch appears in the sidebar nested under the parent.
		await page.goto("/");
		const branchesGroup = page
			.locator(`[data-testid^="project-branches-"]`)
			.first();
		await expect(branchesGroup).toBeVisible({ timeout: 10_000 });
		await expect(
			branchesGroup.getByRole("link", {
				name: new RegExp(escapeRegex(branchTitle)),
			}),
		).toBeVisible();
		// Description renders as a muted second line on the row.
		await expect(
			branchesGroup.getByText(branchDescription, { exact: false }),
		).toBeVisible();
	});

	test("rename / edit description updates the project list", async ({
		page,
	}) => {
		const title = `Comments demo ${Date.now()}`;
		await createProject(page, title);

		await openBranchMenu(page);
		await page.getByTestId("project-rename-action").click();
		const renameDialog = page.getByTestId("branch-project-dialog");
		await expect(renameDialog).toBeVisible();
		const newTitle = `${title} (renamed)`;
		await renameDialog
			.getByTestId("branch-project-dialog-title")
			.fill(newTitle);
		await renameDialog
			.getByTestId("branch-project-dialog-description")
			.fill("Description added via rename dialog");
		await renameDialog.getByRole("button", { name: /save/i }).click();
		await expect(renameDialog).toBeHidden({ timeout: 10_000 });

		await page.goto("/");
		await page.reload();
		await expect(
			page
				.getByRole("link", { name: new RegExp(escapeRegex(newTitle)) })
				.first(),
		).toBeVisible({ timeout: 15_000 });
		// The description now renders in two places — the sidebar project list
		// and the home-page project card — so scope to the first match.
		await expect(
			page
				.getByText("Description added via rename dialog", { exact: false })
				.first(),
		).toBeVisible();
	});
});

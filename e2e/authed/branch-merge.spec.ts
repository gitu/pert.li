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
	// Wizard step 1: pick the blank starting point to reveal the title field.
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
}

async function openBranchMenu(
	page: import("@playwright/test").Page,
): Promise<void> {
	// Branch / rename live in the Overview tab's project actions (the default
	// landing view), not the header toolbar anymore.
	await page.getByTestId("overview-branch-menu").click();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectIdFromUrl(url: string): string {
	const m = url.match(/\/p\/([^/?#]+)/);
	if (!m) throw new Error(`No project id in url: ${url}`);
	return m[1];
}

// Forks the currently-open project via the Overview Branch menu and returns
// the new branch's project id (we land on the branch after creation).
async function branchCurrentProject(
	page: import("@playwright/test").Page,
	title: string,
): Promise<string> {
	const fromUrl = page.url();
	await openBranchMenu(page);
	await page.getByTestId("overview-branch-action").click();
	const dialog = page.getByTestId("branch-project-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("branch-project-dialog-title").fill(title);
	await dialog.getByRole("button", { name: /create branch/i }).click();
	await expect(dialog).toBeHidden({ timeout: 15_000 });
	await page.waitForURL(
		(url) => url.pathname.startsWith("/p/") && url.toString() !== fromUrl,
		{ timeout: 10_000 },
	);
	return projectIdFromUrl(page.url());
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
		await page.getByTestId("overview-branch-action").click();
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
		await page.getByTestId("overview-rename-action").click();
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

	test("branches nest recursively on the home page and promote detaches one", async ({
		page,
	}) => {
		const stamp = Date.now();
		// A -> B -> C. We only rely on the branch ids: "New project" registers its
		// row optimistically, so the URL we land on after create carries a local
		// alias id, not the canonical project id branches point at. Fork, by
		// contrast, returns the canonical id (the branch's URL == its row id), so
		// B and C are addressable by the testids the project list renders.
		await createProject(page, `Roadmap ${stamp}`);
		const branchId = await branchCurrentProject(page, `Aggressive ${stamp}`);
		const deepId = await branchCurrentProject(page, `Skip QA gate ${stamp}`);

		// A branch card nested anywhere under a parent lives inside a
		// `home-project-branches-*` container; a root card does not.
		const cardInSomeBranchContainer = (id: string) =>
			page
				.locator('[data-testid^="home-project-branches-"]')
				.filter({ has: page.getByTestId(`project-card-${id}`) });

		await page.goto("/");
		await expect(page.getByTestId(`project-card-${branchId}`)).toBeVisible({
			timeout: 15_000,
		});
		// B nests under its parent (A), and C (branch of B) nests one level deeper
		// inside B's own container — true recursion, not a flattened list.
		await expect(cardInSomeBranchContainer(branchId)).toHaveCount(1);
		await expect(
			page
				.getByTestId(`home-project-branches-${branchId}`)
				.getByTestId(`project-card-${deepId}`),
		).toBeVisible();

		// Promote B from its Overview Branch menu.
		await page.goto(`/p/${branchId}`);
		await openBranchMenu(page);
		await page.getByTestId("overview-promote-action").click();
		const promoteDialog = page.getByTestId("promote-branch-dialog");
		await expect(promoteDialog).toBeVisible();
		await promoteDialog.getByTestId("promote-branch-confirm").click();
		await expect(promoteDialog).toBeHidden({ timeout: 15_000 });

		// Back home: B is now a root (no longer inside any branch container), yet
		// still carries C nested under it.
		await page.goto("/");
		await expect(page.getByTestId(`project-card-${branchId}`)).toBeVisible({
			timeout: 15_000,
		});
		await expect(cardInSomeBranchContainer(branchId)).toHaveCount(0);
		await expect(
			page
				.getByTestId(`home-project-branches-${branchId}`)
				.getByTestId(`project-card-${deepId}`),
		).toBeVisible();
	});
});

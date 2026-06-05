// Phase 1: mobile shell skeleton. The phone-viewport project must render
// the hamburger top bar (not the desktop sidebar) and, inside a project,
// the bottom tab nav. Switching tabs writes `?view=` exactly the way the
// desktop project header does.

import { expect, test } from "../../console";

test("workspace home renders the mobile top bar, not the desktop sidebar", async ({
	page,
}) => {
	await page.goto("/");

	await expect(page.getByTestId("mobile-topbar-menu")).toBeVisible({
		timeout: 10_000,
	});

	// The desktop panel-collapse toggles (`panel-toggle-left`,
	// `panel-toggle-bottom`) live on the desktop shell's resize dividers, which
	// must not render on phones.
	await expect(page.getByTestId("panel-toggle-left")).toHaveCount(0);
	await expect(page.getByTestId("panel-toggle-bottom")).toHaveCount(0);

	const viewport = page.viewportSize();
	const scrollWidth = await page.evaluate(
		() => document.documentElement.scrollWidth,
	);
	expect(scrollWidth).toBeLessThanOrEqual(viewport?.width ?? 0);
});

test("hamburger opens the projects sheet", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("mobile-topbar-menu").click();
	await expect(
		page.getByRole("heading", { name: "Projects", exact: true }),
	).toBeVisible();
});

test("inside a project, the bottom tab nav switches the view search param", async ({
	page,
}) => {
	// Create a fresh project. There's no desktop "New project" button on the
	// mobile shell, so use the in-sheet "+" affordance.
	await page.goto("/");
	await page.getByTestId("mobile-topbar-menu").click();
	await page.getByRole("button", { name: "New project" }).click();

	const title = `Mobile shell e2e ${Date.now()}`;
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();

	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	const bottomNav = page.getByTestId("mobile-bottom-nav");
	await expect(bottomNav).toBeVisible();

	// Each tab tap should mutate the URL search.
	await page.getByTestId("mobile-view-tab-timeline").click();
	await expect(page).toHaveURL(/[?&]view=timeline/);

	await page.getByTestId("mobile-view-tab-table").click();
	await expect(page).toHaveURL(/[?&]view=table/);

	await page.getByTestId("mobile-view-tab-matrix").click();
	await expect(page).toHaveURL(/[?&]view=matrix/);

	// Switching back to "network" drops the search param entirely (default).
	await page.getByTestId("mobile-view-tab-network").click();
	await expect(page).not.toHaveURL(/[?&]view=/);

	// No horizontal scroll on the project shell either.
	const viewport = page.viewportSize();
	const scrollWidth = await page.evaluate(
		() => document.documentElement.scrollWidth,
	);
	expect(scrollWidth).toBeLessThanOrEqual(viewport?.width ?? 0);
});

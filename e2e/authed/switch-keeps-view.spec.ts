import { expect, type Page, test } from "@playwright/test";

// Switching between projects via the sidebar should preserve the active view
// (URL `view` search param) — e.g. if you're on the Network view of plan A and
// jump to plan B, you land on B's Network view, not its default Overview.

// Creates a blank project and waits for the project route to load. We locate
// the resulting sidebar row by *title* (not by the URL id): a project is
// created with a local id, then re-keyed to its server id once registered, so
// the freshly-navigated `/p/<localId>` differs from the row's canonical
// `/p/<serverId>` href. Title is the stable handle (same approach as
// projects.spec.ts).
async function createBlankProject(page: Page, title: string): Promise<void> {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await expect(
		page.getByRole("heading", { name: "New project" }),
	).toBeVisible();
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\//, { timeout: 10_000 });
}

test.describe("Switching projects keeps the active view", () => {
	test("Network view carries across a sidebar project switch", async ({
		page,
	}) => {
		const stamp = Date.now();
		const titleA = `Keep-view A ${stamp}`;
		const titleB = `Keep-view B ${stamp}`;
		await createBlankProject(page, titleA);
		await createBlankProject(page, titleB);

		// On project B, switch to the Network view via the in-app tab.
		await page.getByTestId("view-tab-network").click();
		await page.waitForURL(/\?view=network/, { timeout: 10_000 });

		// The sidebar row for A carries the active view in its link, so a switch
		// keeps you on Network instead of bouncing to Overview.
		const rowA = page.getByRole("link", { name: titleA }).first();
		await expect(rowA).toHaveAttribute("href", /\?view=network/);

		// Clicking it actually lands on A's Network view.
		await rowA.click();
		await page.waitForURL(/\/p\/[^/?]+\?view=network/, { timeout: 10_000 });
		await expect(page.getByTestId("view-tab-network")).toHaveAttribute(
			"aria-selected",
			"true",
		);

		// And jumping back to B keeps Network too.
		const rowB = page.getByRole("link", { name: titleB }).first();
		await expect(rowB).toHaveAttribute("href", /\?view=network/);
		await rowB.click();
		await page.waitForURL(/\/p\/[^/?]+\?view=network/, { timeout: 10_000 });
	});

	test("Overview (default) does not add a view param when switching", async ({
		page,
	}) => {
		const stamp = Date.now();
		const titleA = `Overview A ${stamp}`;
		await createBlankProject(page, titleA);
		await createBlankProject(page, `Overview B ${stamp}`);

		// On B's default Overview, the sidebar row for A links to the bare
		// project route — no view param — so switching lands on Overview.
		const rowA = page.getByRole("link", { name: titleA }).first();
		await expect(rowA).toHaveAttribute("href", /\/p\/[^?]+$/);

		await rowA.click();
		await page.waitForURL(/\/p\//, { timeout: 10_000 });
		expect(page.url()).not.toContain("view=");
	});
});

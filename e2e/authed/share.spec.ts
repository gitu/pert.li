// Share-link chrome, driven through the real owner flow: create a project,
// mint a link from the overview Share dialog, then open it as an anonymous
// recipient in a fresh browser context (no stored auth) — the truly
// logged-out public surface.
//
// Scope note: the share route syncs the Automerge doc only over the WebSocket
// `/sync`, but the e2e harness runs VITE_E2E_DISABLE_SYNC=1 with per-worker
// PGLite, so the recipient's *canvas* never materializes ("Connecting…").
// These tests therefore assert only the DB-driven chrome (read-only banner,
// mode badge, edit-share name prompt, invalidation), which renders above the
// canvas regardless. The "cannot delete/modify tasks" enforcement is proven
// deterministically at the component layer (TaskInspector / TaskNode stories).
//
// We use @playwright/test (not the console-clean fixture): the recipient page
// opens a real `/sync` socket that the stub server can't satisfy, so transient
// reconnection warnings are expected here and must not fail the test. The
// owner-side mutations (create project, createProjectShare) may hang under the
// local stub server — that's a documented environment quirk; this spec is
// CI-targeted.

import { expect, type Page, test } from "@playwright/test";

async function createProject(page: Page, title: string): Promise<void> {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 15_000 });
}

// Mint a share link from the overview Share dialog and return its URL.
async function createShareLink(
	page: Page,
	mode: "view" | "edit",
): Promise<string> {
	await page.getByTestId("overview-share").click();
	await expect(
		page.getByRole("heading", { name: "Share this project" }),
	).toBeVisible();

	if (mode === "edit") {
		// shadcn/Radix Select: open the Access trigger, choose "Can edit".
		await page.locator("#share-mode").click();
		await page.getByRole("option", { name: "Can edit" }).click();
	}

	await page.getByTestId("create-share-link").click();

	// The new row carries the URL in a read-only input; newest is prepended, so
	// the first one is the link we just created.
	const urlInput = page.getByLabel("Share link URL").first();
	await expect(urlInput).toBeVisible({ timeout: 15_000 });
	const url = await urlInput.inputValue();
	expect(url).toMatch(/\/share\/.+/);
	return url;
}

test.describe("Share links (authed owner → anonymous recipient)", () => {
	test("view link: recipient sees the read-only surface; revoking invalidates it", async ({
		page,
		browser,
	}) => {
		await createProject(page, `Share view ${Date.now()}`);
		const url = await createShareLink(page, "view");

		// Open as a logged-out recipient.
		const recipient = await browser.newContext();
		const rp = await recipient.newPage();
		await rp.goto(url);

		await expect(rp.getByTestId("share-readonly-banner")).toBeVisible({
			timeout: 15_000,
		});
		await expect(rp.getByTestId("share-mode-badge")).toContainText("View only");
		// No name prompt for a view share — viewers don't push presence.
		await expect(rp.getByTestId("share-name-submit")).toHaveCount(0);

		// Owner revokes the link (only one active row).
		await page.getByLabel("Revoke link").click();

		// A fresh load of the same URL now resolves to the invalid-link page.
		const rp2 = await recipient.newPage();
		await rp2.goto(url);
		await expect(
			rp2.getByRole("heading", { name: "This link is no longer valid" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(rp2.getByTestId("share-readonly-banner")).toHaveCount(0);

		await recipient.close();
	});

	test("edit link: recipient gets the name prompt, then a 'Can edit' surface", async ({
		page,
		browser,
	}) => {
		await createProject(page, `Share edit ${Date.now()}`);
		const url = await createShareLink(page, "edit");

		const recipient = await browser.newContext();
		const rp = await recipient.newPage();
		await rp.goto(url);

		// Edit shares prompt for a display name before revealing the canvas; the
		// mode badge only appears after the name is set.
		const nameInput = rp.locator("#share-display-name");
		await expect(nameInput).toBeVisible({ timeout: 15_000 });
		await nameInput.fill("Sam from Ops");
		await rp.getByTestId("share-name-submit").click();

		// Now the editable surface mounts: the "Can edit" badge shows and there's
		// no read-only banner.
		await expect(rp.getByTestId("share-mode-badge")).toContainText("Can edit", {
			timeout: 15_000,
		});
		await expect(rp.getByTestId("share-readonly-banner")).toHaveCount(0);

		await recipient.close();
	});
});

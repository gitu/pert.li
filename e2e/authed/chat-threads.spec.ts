import { expect, type Page, test } from "@playwright/test";

// End-to-end exercise of the chat tab strip: create, switch, rename, delete,
// reload-persistence. The chat panel only mounts inside an open project —
// chat is bound to the active plan — so each test creates and opens one
// before exercising the dock.
//
// We pre-pin the chat dock via localStorage so the panel renders on the very
// first paint without needing to click the trigger (cheaper and removes a
// race with React hydration on the topbar).

async function openFreshProject(page: Page): Promise<void> {
	await page.goto("/");
	// Topbar lives in the page banner; `header` would also match the chat
	// panel's own <header>, so scope by role.
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await expect(
		page.getByRole("heading", { name: "New project" }),
	).toBeVisible();
	const title = `E2E chat ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
}

test.describe("Chat threads", () => {
	test.beforeEach(async ({ context, page }) => {
		await context.addInitScript(() => {
			// Pre-pin the chat so the panel mounts immediately on the project
			// route, regardless of what previous tests may have written.
			window.localStorage.setItem("pertli.chatDock", "pinned");
			// Suppress the cookie hint so it can't sit on top of any tab chrome.
			window.localStorage.setItem("pertli.cookieHintDismissed.v1", "1");
		});
		await openFreshProject(page);
	});

	test("default thread auto-exists and is named 'New chat'", async ({
		page,
	}) => {
		const tabs = page.getByTestId("chat-tabs");
		await expect(tabs).toBeVisible();
		// One tab present, titled with the placeholder.
		await expect(tabs.locator("[role='tab']")).toHaveCount(1);
		await expect(tabs.locator("[role='tab']").first()).toHaveText(/New chat/);
		await expect(page.getByTestId("chat-tab-new")).toBeVisible();
	});

	test("clicking + creates a new thread, switching tabs preserves transcripts", async ({
		page,
	}) => {
		const tabs = page.getByTestId("chat-tabs");
		await expect(tabs).toBeVisible();

		// Seed the original thread directly via localStorage — sending a real
		// user message round-trips through SSE which this spec deliberately
		// avoids. The persistence layer is the contract we're exercising here.
		const originalSnapshot = [
			{
				id: "u-original",
				role: "user",
				parts: [{ type: "text", content: "Original thread message" }],
			},
		];
		const firstTabId = await page.evaluate(() => {
			// Threads are scoped per project — find the project-keyed index that
			// the panel just seeded. There's only one because we just opened a
			// fresh project.
			const key = Object.keys(window.localStorage).find((k) =>
				k.startsWith("pertli.chatThreads.v1.project:"),
			);
			if (!key) throw new Error("Project-scoped thread index not seeded");
			const raw = window.localStorage.getItem(key);
			if (!raw) throw new Error("Thread index empty");
			const idx = JSON.parse(raw);
			return idx.activeThreadId as string;
		});
		await page.evaluate(
			(args: { id: string; snap: unknown }) => {
				window.localStorage.setItem(
					`pertli.chatThread.v1.${args.id}`,
					JSON.stringify(args.snap),
				);
			},
			{ id: firstTabId, snap: originalSnapshot },
		);
		await page.reload();

		// Original message should now be visible in the transcript. Scope to
		// the user-message row so we don't collide with the auto-derived tab
		// title (which uses the same text).
		const transcriptUserMsg = page.getByTestId("chat-message-user");
		await expect(transcriptUserMsg).toHaveText(/Original thread message/);

		// Click + to spawn a new thread.
		await page.getByTestId("chat-tab-new").click();
		await expect(tabs.locator("[role='tab']")).toHaveCount(2);

		// The new tab is active; the original transcript row should no longer
		// be in the DOM (the new thread has no messages yet).
		await expect(transcriptUserMsg).toHaveCount(0);

		// Switch back to the original tab.
		await page.getByTestId(`chat-tab-${firstTabId}`).click();
		await expect(page.getByTestId("chat-message-user")).toHaveText(
			/Original thread message/,
		);
	});

	test("double-click renames a tab and the rename persists across reload", async ({
		page,
	}) => {
		const tabs = page.getByTestId("chat-tabs");
		await expect(tabs).toBeVisible();
		const firstTab = tabs.locator("[role='tab']").first();
		const tabId = await firstTab.getAttribute("data-testid");
		expect(tabId).toBeTruthy();
		const id = tabId?.replace("chat-tab-", "") ?? "";

		await firstTab.dblclick();
		const input = page.getByTestId(`chat-tab-rename-${id}`);
		await expect(input).toBeVisible();
		await input.fill("Launch plan");
		await input.press("Enter");
		await expect(firstTab).toHaveText(/Launch plan/);

		await page.reload();
		await expect(page.getByTestId(`chat-tab-${id}`)).toHaveText(/Launch plan/);
	});

	test("close button on an empty extra thread removes it without confirm", async ({
		page,
	}) => {
		const tabs = page.getByTestId("chat-tabs");
		await expect(tabs).toBeVisible();

		// Spawn an extra empty thread.
		await page.getByTestId("chat-tab-new").click();
		await expect(tabs.locator("[role='tab']")).toHaveCount(2);

		// Pick whichever tab is the newly-created one (it's the active one).
		const newTab = tabs.locator("[role='tab'][aria-selected='true']").first();
		const newId =
			(await newTab.getAttribute("data-testid"))?.replace("chat-tab-", "") ??
			"";

		// Hover to reveal the close button, then click it. The thread is empty
		// so no confirm() dialog fires.
		await newTab.hover();
		await page.getByTestId(`chat-tab-close-${newId}`).click();
		await expect(tabs.locator("[role='tab']")).toHaveCount(1);
	});

	test("close on the only remaining thread is hidden", async ({ page }) => {
		const tabs = page.getByTestId("chat-tabs");
		await expect(tabs).toBeVisible();
		const firstTab = tabs.locator("[role='tab']").first();
		const id =
			(await firstTab.getAttribute("data-testid"))?.replace("chat-tab-", "") ??
			"";
		await expect(page.getByTestId(`chat-tab-close-${id}`)).toHaveCount(0);
	});
});

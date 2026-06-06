import { expect, type Page, test } from "@playwright/test";

// Regression: a collaborator's edit must NOT move my canvas viewport.
//
// Before the fix, `useRecentlyCreatedHighlight` panned the camera onto ANY
// task that newly appeared in the doc — including ones a remote peer added —
// so adding a task in one client yanked every other client's view. The fix
// pans only to tasks THIS client created (they flow through `changeDoc`);
// remote additions arrive via Automerge sync and are left alone.
//
// Two tabs in the same browser context sync via the BroadcastChannel network
// adapter (the WebSocket sync is disabled under VITE_E2E_DISABLE_SYNC=1, but
// BroadcastChannel stays on), so tab B observing tab A's addition exercises
// the exact remote-change path.

const VIEWPORT = ".react-flow__viewport";
const NODE = ".react-flow__node";

async function createProject(page: Page): Promise<string> {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	// Wizard step 1: pick the blank starting point to reveal the title field.
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(`Collab viewport ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+$/, { timeout: 10_000 });
	return page.url();
}

// Drag the canvas pane so the viewport transform is shifted well away from its
// initial fitView position — gives a buggy recenter something visible to undo.
async function panAway(page: Page) {
	const pane = page.locator(".react-flow__pane");
	const box = await pane.boundingBox();
	if (!box) throw new Error("canvas pane not found");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.move(cx + 220, cy + 160, { steps: 12 });
	await page.mouse.up();
}

test("a collaborator's task addition does not move my viewport", async ({
	page,
	context,
}) => {
	const url = await createProject(page);

	// Seed one task in tab A so both tabs have content + a stable node count.
	await page.getByTestId("toolbar-add-task").click();
	await expect(page.locator(NODE)).toHaveCount(1, { timeout: 15_000 });

	// Tab B opens the same project; BroadcastChannel delivers the seed task.
	const pageB = await context.newPage();
	await pageB.goto(url);
	await expect(pageB.locator(NODE)).toHaveCount(1, { timeout: 15_000 });

	// B pans away, then we snapshot its viewport transform.
	await panAway(pageB);
	await pageB.waitForTimeout(200);
	const before = await pageB.locator(VIEWPORT).getAttribute("style");

	// Tab A (the "collaborator") adds another task.
	await page.getByTestId("toolbar-add-task").click();

	// B receives it via sync...
	await expect(pageB.locator(NODE)).toHaveCount(2, { timeout: 15_000 });
	// ...and any (buggy) pan animation would have finished by now (350ms).
	await pageB.waitForTimeout(800);

	// B's viewport must be exactly where the user left it.
	const after = await pageB.locator(VIEWPORT).getAttribute("style");
	expect(after).toBe(before);

	await pageB.close();
});

test("adding a task myself still recenters my view onto it", async ({
	page,
}) => {
	await createProject(page);

	await page.getByTestId("toolbar-add-task").click();
	await expect(page.locator(NODE)).toHaveCount(1, { timeout: 15_000 });

	// Pan away from the freshly-centered node, snapshot, then add another task
	// locally — the recently-created highlight should pan the camera onto it,
	// changing the transform.
	await panAway(page);
	await page.waitForTimeout(200);
	const before = await page.locator(VIEWPORT).getAttribute("style");

	await page.getByTestId("toolbar-add-task").click();
	await expect(page.locator(NODE)).toHaveCount(2, { timeout: 15_000 });
	await page.waitForTimeout(800);

	const after = await page.locator(VIEWPORT).getAttribute("style");
	expect(after).not.toBe(before);
});

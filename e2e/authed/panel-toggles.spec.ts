// The sidebar and bottom-panel collapse toggles now live on the panels' own
// resize dividers (not the top bar). These specs exercise the actual
// collapse → expand round-trip: the toggle's `aria-pressed` reflects the
// expanded state and the panel content hides/shows. The console-clean fixture
// (see ../console) fails the test on any browser console error or warning, so
// each interaction is also a console check.

import { expect, test } from "../console";

test("sidebar divider toggle collapses and re-expands the sidebar", async ({
	page,
}) => {
	await page.goto("/");

	const toggle = page.getByTestId("panel-toggle-left");
	await expect(toggle).toBeVisible();
	// Expanded to start: aria-pressed mirrors "not collapsed".
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	// The workspace switcher lives with the sidebar and shows while expanded.
	await expect(page.getByRole("banner").getByText("Workspace")).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	// Sidebar collapsed to zero width → its workspace switcher is gone, but the
	// toggle itself stays pinned on the divider at the screen edge so the user
	// can re-open it.
	await expect(page.getByRole("banner").getByText("Workspace")).toHaveCount(0);
	await expect(toggle).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("banner").getByText("Workspace")).toBeVisible();
});

test("bottom-panel divider toggle collapses and re-expands the details panel", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByLabel("Title").fill(`Panel toggles ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	const toggle = page.getByTestId("panel-toggle-bottom");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	// The details/plan/track/history tabs live in the bottom panel.
	await expect(page.getByTestId("right-tabs")).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	// Collapsed to zero height → the tab strip is no longer visible, but the
	// toggle stays on the divider at the canvas's bottom edge.
	await expect(page.getByTestId("right-tabs")).toBeHidden();
	await expect(toggle).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("right-tabs")).toBeVisible();
});

test("chat-rail divider toggle collapses and re-expands the pinned chat", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("banner")
		.getByRole("button", { name: "New project" })
		.click();
	await page.getByLabel("Title").fill(`Chat rail ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	// Open the chat (sheet) then pin it into the right rail, where the divider
	// toggle lives.
	await page.getByTestId("topbar-chat-trigger").click();
	const pin = page.getByTestId("chat-pin-toggle");
	await expect(pin).toBeVisible();
	await pin.click();

	const toggle = page.getByTestId("panel-toggle-chat");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	// The pin control lives in the chat header, inside the rail.
	await expect(page.getByTestId("chat-pin-toggle")).toBeVisible();

	const horizontalOverflow = () =>
		page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	// Rail collapsed to zero width: the toggle stays pinned on the divider so
	// the rail can be brought back without unpinning, and the collapsed (clipped)
	// chat content must not spill and push a horizontal scrollbar onto the page.
	await expect(toggle).toBeVisible();
	expect(await horizontalOverflow()).toBeLessThanOrEqual(1);

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("chat-pin-toggle")).toBeVisible();
});

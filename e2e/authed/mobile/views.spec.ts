// Phase 3: mobile view variants are exhaustively covered by Storybook —
// `TaskCardList`, `TimelineMobile`, and `MatrixMobile` each have stories
// with populated docs and play assertions. With the e2e harness running
// `VITE_E2E_DISABLE_SYNC=1` the project's Automerge doc never resolves,
// so we can't render the mobile views end-to-end here. What this spec
// guards instead: cycling through the four bottom-nav tabs on mobile
// must never cause horizontal overflow — even while the doc is still
// "Loading document…".

import { expect, test } from "../../console";

test("none of the bottom-nav tabs trigger horizontal overflow", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByTestId("mobile-topbar-menu").click();
	await page.getByRole("button", { name: "New project" }).click();
	await page.getByTestId("create-choice-empty").click();
	await page.getByLabel("Title").fill(`Views e2e ${Date.now()}`);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL(/\/p\/[^/]+(\?|$)/, { timeout: 10_000 });

	const viewport = page.viewportSize();
	const assertNoOverflow = async () => {
		const scrollWidth = await page.evaluate(
			() => document.documentElement.scrollWidth,
		);
		expect(scrollWidth).toBeLessThanOrEqual(viewport?.width ?? 0);
	};

	for (const tab of ["table", "timeline", "matrix", "network"] as const) {
		await page.getByTestId(`mobile-view-tab-${tab}`).click();
		await assertNoOverflow();
	}
});

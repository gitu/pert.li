// Uses the console-clean fixture so any browser console error/warning — a React
// SSR hydration mismatch included — fails the test. The methodology page is
// long-form prose rendered through the Tailwind `prose` plugin; this guards
// against both a broken route and a hydration drift.

import { expect, test } from "./console";
import { COOKIE_HINT_KEY } from "./fixtures";

test.describe("/methodology (unauthenticated)", () => {
	test("renders the calculations reference with its key sections", async ({
		page,
	}) => {
		await page.goto("/methodology");
		await expect(
			page.getByRole("heading", {
				name: "How the numbers are calculated",
				level: 1,
			}),
		).toBeVisible();
		// Each major engine concept has a section heading.
		for (const name of [
			"Expected duration (the PERT weighted mean)",
			"Critical Path Method — the schedule",
			"Team capacity: effort vs. duration",
			"Schedule basis & parallel staffing",
			"Monte Carlo forecast",
		]) {
			await expect(page.getByRole("heading", { name })).toBeVisible();
		}
		// The worked PERT example is present.
		await expect(page.getByText(/9\.47 days/)).toBeVisible();
		// The parallel-staffing formula is documented.
		await expect(
			page.getByText(/people = clamp\(floor\(size \/ level\), 1, maxPerTask\)/),
		).toBeVisible();
	});

	test("server-renders its content (works before client JS)", async ({
		request,
	}) => {
		const res = await request.get("/methodology");
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(html).toContain("How the numbers are calculated");
		expect(html).toContain("Monte Carlo forecast");
		expect(html).toContain("Team capacity");
		expect(html).toContain("Schedule basis");
		expect(html).toContain("parallel staffing");
	});

	test("the in-page table of contents jumps to a section", async ({ page }) => {
		await page.goto("/methodology");
		await page.getByRole("link", { name: "Monte Carlo forecast" }).click();
		await expect(page).toHaveURL(/#montecarlo$/);
	});

	test("is reachable from the marketing footer", async ({ page }) => {
		// The cookie-hint banner is `fixed bottom-0` and overlays the page-bottom
		// footer, so its links aren't clickable until it's gone. Pre-dismiss it
		// (as a returning visitor would have) so the link is actionable.
		await page.addInitScript(
			(key) => window.localStorage.setItem(key, "1"),
			COOKIE_HINT_KEY,
		);
		await page.goto("/about");
		await page
			.getByRole("contentinfo")
			.getByRole("link", { name: "How it works" })
			.click();
		await expect(page).toHaveURL(/\/methodology$/);
		await expect(
			page.getByRole("heading", {
				name: "How the numbers are calculated",
				level: 1,
			}),
		).toBeVisible();
	});
});

// Imports `test`/`expect` from the console-clean fixture (not @playwright/test)
// so any browser console error or warning — including a React SSR hydration
// mismatch — fails these tests. The About page renders build metadata, which is
// a classic hydration-mismatch trap, so we want that guard here.

import { expect, test } from "./console";
import { COOKIE_HINT_KEY } from "./fixtures";

test.describe("/about (unauthenticated)", () => {
	test("renders the about page and states pert.li is open source", async ({
		page,
	}) => {
		await page.goto("/about");
		await expect(
			page.getByRole("heading", { name: "About pert.li", level: 1 }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Open source", exact: true }),
		).toBeVisible();
		await expect(
			page.getByText(/open source software, released under the MIT license/i),
		).toBeVisible();
		// Links to the public source repository.
		await expect(
			page.getByRole("link", { name: "github.com/gitu/pert.li" }),
		).toHaveAttribute("href", "https://github.com/gitu/pert.li");
	});

	test("server-renders its content (works before client JS)", async ({
		request,
	}) => {
		// Fetch the raw HTML the server streams — no browser, no client render.
		// If the page only rendered on the client this body would be the empty
		// shell. Asserting the copy is present proves SSR.
		const res = await request.get("/about");
		expect(res.status()).toBe(200);
		const html = await res.text();
		expect(html).toContain("About pert.li");
		expect(html).toContain("released under the MIT license");
		expect(html).toContain("github.com/gitu/pert.li");
	});

	test("surfaces the build version", async ({ page }) => {
		await page.goto("/about");
		// The exact value depends on `git describe` at build time, so we don't pin
		// it — just confirm a non-empty version string lands in the DOM.
		const version = page.getByTestId("about-build-version");
		await expect(version).toBeVisible();
		await expect(version).toHaveText(/\S+/);
	});

	test("links back to the home page", async ({ page }) => {
		await page.goto("/about");
		await page.getByRole("link", { name: /back to home/i }).click();
		await expect(page).toHaveURL(/\/$/);
	});

	test("is reachable from the sign-in page footer", async ({ page }) => {
		await page.goto("/signin");
		await page.getByRole("link", { name: "About", exact: true }).click();
		await expect(page).toHaveURL(/\/about$/);
		await expect(
			page.getByRole("heading", { name: "About pert.li", level: 1 }),
		).toBeVisible();
	});

	test("is reachable from the welcome page footer", async ({ page }) => {
		// The cookie-hint banner is `fixed bottom-0` and overlays the page-bottom
		// footer, so its links aren't clickable until it's gone. Pre-dismiss it
		// (as a returning visitor would have) so the About link is actionable.
		await page.addInitScript(
			(key) => window.localStorage.setItem(key, "1"),
			COOKIE_HINT_KEY,
		);
		await page.goto("/welcome");
		await page
			.getByRole("contentinfo")
			.getByRole("link", { name: "About", exact: true })
			.click();
		await expect(page).toHaveURL(/\/about$/);
		await expect(
			page.getByRole("heading", { name: "About pert.li", level: 1 }),
		).toBeVisible();
	});
});

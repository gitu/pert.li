// The PWA manifest is served dynamically from /api/manifest so its install
// name tracks the runtime APP_NAME / APP_TITLE config. The e2e server runs
// without those env vars, so we assert the hosted defaults. Console-clean
// fixture catches any error the manifest link would log in the browser.

import { expect, test } from "./console";

test.describe("/api/manifest", () => {
	test("serves a valid web app manifest with the default brand name", async ({
		request,
	}) => {
		const res = await request.get("/api/manifest");
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain(
			"application/manifest+json",
		);

		const manifest = await res.json();
		expect(manifest.short_name).toBe("pert.li");
		expect(manifest.name).toBe("pert.li — collaborative PERT planning");
		expect(manifest.start_url).toBe("/");
		expect(manifest.display).toBe("standalone");
		// Absolute icon path so it resolves against the origin, not /api/.
		expect(manifest.icons[0].src).toBe("/favicon.svg");
	});

	test("the home page links to the dynamic manifest", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			"href",
			"/api/manifest",
		);
	});
});

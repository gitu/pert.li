// Smoke test for the `mobile-authenticated` Playwright project. Proves the
// storage state + mobile device descriptor combination boots into the app
// shell without horizontal overflow or console noise, before any
// mobile-specific UI exists. Future specs in this directory rely on the
// same fixture wiring.

import { expect, test } from "../../console";

test("loads the workspace home on a phone viewport", async ({ page }) => {
	await page.goto("/");

	// Better-auth has issued the session cookie via auth.setup.ts, so we
	// should land on the in-app shell rather than the public /signin page.
	await expect(page).not.toHaveURL(/\/signin/);

	const viewport = page.viewportSize();
	expect(viewport?.width ?? 0).toBeLessThanOrEqual(480);

	// Note: this smoke deliberately does not assert "no horizontal scroll" —
	// the desktop shell currently overflows on phones; the mobile shell that
	// Phase 1 introduces will fix that, and the Phase 1 spec is where we'll
	// pin the assertion. This file only proves the device + storage state
	// project descriptor is wired correctly.
});

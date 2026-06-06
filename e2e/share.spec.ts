// Public surface of the per-project share link route (`/share/$token`). This
// covers the DB-driven chrome that renders without a materialized Automerge
// doc — the canvas itself can't sync under the e2e harness
// (VITE_E2E_DISABLE_SYNC=1), but the invalid-link page resolves purely from
// `resolveProjectShare`, so it's deterministic everywhere. The view/edit chrome
// for *live* links (which needs an authed owner to mint a token) lives in
// e2e/authed/share.spec.ts.
//
// Console-clean fixture: a bogus token resolves to `null` (not an error), so
// the page must render the explanatory state without logging anything.

import { expect, test } from "./console";

test.describe("/share/$token (public)", () => {
	test("an unknown token renders the invalid-link page", async ({ page }) => {
		// 43-char-ish base64url-shaped string that was never issued.
		await page.goto("/share/this-token-was-never-issued-000000000000000");
		await expect(
			page.getByRole("heading", { name: "This link is no longer valid" }),
		).toBeVisible({ timeout: 15_000 });
		// It offers a way back into the app rather than dead-ending.
		await expect(page.getByRole("link", { name: /Go to/ })).toBeVisible();
		// No share chrome leaks through for an invalid link.
		await expect(page.getByTestId("share-readonly-banner")).toHaveCount(0);
		await expect(page.getByTestId("share-mode-badge")).toHaveCount(0);
	});
});

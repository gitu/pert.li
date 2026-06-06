// Shared fixtures for the Playwright suite. Kept in a non-spec file so
// Playwright lets multiple specs reference it (it forbids spec-to-spec
// imports).

import { type BrowserContext, expect, type Page } from "@playwright/test";

export const E2E_USER = {
	name: "Ada Test",
	email: "ada@e2e.pert.li",
	password: "playwright-e2e-password",
};

export const STORAGE_STATE_PATH = "e2e/.auth/user.json";

export const COOKIE_HINT_KEY = "pertli.cookieHintDismissed.v1";

let freshUserCounter = 0;

// Sign up a brand-new user with a unique email, signing the given context in.
// Use this when a spec needs a *pristine* workspace (e.g. first-run behaviour)
// that the shared E2E_USER — whose workspace other specs populate — can't
// guarantee. Mirrors the signup flow in auth.setup.ts, including the polling
// retry that absorbs the first-request Vite transform / hydration race.
export async function signUpFreshUser(
	page: Page,
	context: BrowserContext,
	opts: { name?: string } = {},
): Promise<{ email: string }> {
	// Pre-dismiss the cookie hint so it doesn't overlap the signin form's mode
	// toggles.
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "1");
	}, COOKIE_HINT_KEY);

	// Unique per run so repeated CI runs against a persisted DB never collide;
	// the counter keeps two fresh users in one run distinct.
	freshUserCounter += 1;
	const email = `fresh-${Date.now()}-${freshUserCounter}@e2e.pert.li`;

	await page.goto("/signin");
	await expect(
		page.getByRole("heading", { name: "Sign in", exact: true }),
	).toBeVisible();

	await expect(async () => {
		await page
			.getByText("No account?")
			.locator("..")
			.getByRole("button", { name: "Sign up" })
			.click();
		await expect(
			page.getByRole("heading", { name: "Create an account" }),
		).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 30_000 });

	await page.getByLabel("Name").fill(opts.name ?? "Fresh Tester");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(E2E_USER.password);
	await page.getByRole("button", { name: "Create account" }).click();

	// Better Auth sets the session cookie by the time submit resolves.
	await expect
		.poll(async () => {
			const cookies = await context.cookies();
			return cookies.some((c) => c.name.includes("better-auth"));
		})
		.toBe(true);

	return { email };
}

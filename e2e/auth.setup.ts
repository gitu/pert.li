import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { COOKIE_HINT_KEY, E2E_USER, STORAGE_STATE_PATH } from "./fixtures";

setup("authenticate", async ({ page, context }) => {
	// Pre-dismiss the cookie hint so it doesn't overlap the inline mode
	// toggles on the signin form.
	await context.addInitScript((key) => {
		window.localStorage.setItem(key, "1");
	}, COOKIE_HINT_KEY);

	await page.goto("/signin");
	await expect(
		page.getByRole("heading", { name: "Sign in", exact: true }),
	).toBeVisible();

	// Switch to the signup form, fill it in, and submit. The memory adapter
	// has no prior state so the first run always creates the user; in this
	// suite there's no persistent storage between server restarts, so we
	// can rely on "always create" without checking for an existing account.
	//
	// Polling retry: the setup spec is the very first request against the
	// Playwright-managed dev server, so the /signin route is still being
	// transformed by Vite on the first click and React may not have
	// hydrated yet. Re-clicking is harmless (idempotent setMode call).
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

	await page.getByLabel("Name").fill(E2E_USER.name);
	await page.getByLabel("Email").fill(E2E_USER.email);
	await page.getByLabel("Password").fill(E2E_USER.password);
	await page.getByRole("button", { name: "Create account" }).click();

	// Signed-in routes are still going to fail because they query the live
	// db proxy for workspaces. We don't need to navigate there — better-auth
	// has already set the session cookie by the time the submit resolves.
	// Wait for the cookie to land before saving storage state.
	await expect
		.poll(async () => {
			const cookies = await context.cookies();
			return cookies.some((c) => c.name.includes("better-auth"));
		})
		.toBe(true);

	await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });
	await context.storageState({ path: STORAGE_STATE_PATH });
});

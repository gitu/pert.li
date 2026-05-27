import { expect, test } from "@playwright/test";

test.describe("/signin", () => {
	// Pre-dismiss the cookie hint so it can't overlap the inline mode-toggle
	// buttons at the bottom of the form. The hint itself has its own dedicated
	// tests; here it's just visual noise.
	test.beforeEach(async ({ context }) => {
		await context.addInitScript(() => {
			window.localStorage.setItem("pertli.cookieHintDismissed.v1", "1");
		});
	});

	test("defaults to sign-in mode", async ({ page }) => {
		await page.goto("/signin");
		await expect(
			page.getByRole("heading", { name: "Sign in", exact: true }),
		).toBeVisible();
		await expect(page.getByLabel("Email")).toBeVisible();
		await expect(page.getByLabel("Password")).toBeVisible();
	});

	test("Sign up mode surfaces the passwordless option in the subtitle and the link button", async ({
		page,
	}) => {
		await page.goto("/signin");
		await expect(
			page.getByRole("heading", { name: "Sign in", exact: true }),
		).toBeVisible();
		await page
			.getByText("No account?")
			.locator("..")
			.getByRole("button", { name: "Sign up" })
			.click();
		await expect(
			page.getByRole("heading", { name: "Create an account" }),
		).toBeVisible();
		await expect(page.getByText(/prefer not to set a password/i)).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: /skip the password/i,
			}),
		).toBeVisible();
	});

	test("Magic-link mode hides the password field and explains it works for new accounts", async ({
		page,
	}) => {
		await page.goto("/signin");
		await expect(
			page.getByRole("heading", { name: "Sign in", exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Email me a sign-in link instead" })
			.click();
		await expect(
			page.getByRole("heading", { name: "Email me a sign-in link" }),
		).toBeVisible();
		await expect(page.getByLabel("Email")).toBeVisible();
		await expect(page.getByLabel("Password")).toHaveCount(0);
		await expect(page.getByText(/works for new accounts too/i)).toBeVisible();
	});

	test("does not show an OIDC button when no provider is configured", async ({
		page,
	}) => {
		await page.goto("/signin");
		await expect(
			page.getByRole("button", { name: /continue with/i }),
		).toHaveCount(0);
	});

	test("footer links to the privacy policy", async ({ page }) => {
		await page.goto("/signin");
		await page.getByRole("link", { name: "Privacy", exact: true }).click();
		await expect(page).toHaveURL(/\/privacy$/);
	});

	test("surfaces the build version below the sign-in card", async ({ page }) => {
		await page.goto("/signin");
		const version = page.getByTestId("app-version");
		await expect(version).toBeVisible();
		await expect(version).toHaveText(/\S+/);
	});
});

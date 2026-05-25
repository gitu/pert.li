// Shared fixtures for the Playwright suite. Kept in a non-spec file so
// Playwright lets multiple specs reference it (it forbids spec-to-spec
// imports).

export const E2E_USER = {
	name: "Ada Test",
	email: "ada@e2e.pert.li",
	password: "playwright-e2e-password",
};

export const STORAGE_STATE_PATH = "e2e/.auth/user.json";

export const COOKIE_HINT_KEY = "pertli.cookieHintDismissed.v1";

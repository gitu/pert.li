import { defineConfig, devices } from "@playwright/test";

// End-to-end tests live in `./e2e`. They drive the real app through Chromium
// against a Playwright-managed dev server on port 3100 (so it never fights
// the developer's `pnpm dev` on 3000). The server runs with E2E_PGLITE=1 so
// the Drizzle client routes through an in-process Postgres (PGLite) instead
// of Neon. Schema is pushed at boot, better-auth + workspace queries all
// hit a real DB, and the suite can drive sign-up / project creation /
// project navigation end-to-end.
const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const STORAGE_STATE = "e2e/.auth/user.json";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// Cap workers to 2: Vite dev-mode transforms modules on demand and racing
	// 5 simultaneous first-loads makes React hydration flaky. CI gets 1 worker
	// for full determinism; local dev gets 2 for a faster feedback loop while
	// staying stable.
	workers: process.env.CI ? 1 : 2,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`,
		trace: "on-first-retry",
	},
	projects: [
		// Unauthenticated public surfaces (welcome, signin, privacy, cookies).
		// Each test gets a fresh context — no storage state injected.
		{
			name: "public",
			use: { ...devices["Desktop Chrome"] },
			testIgnore: ["**/auth.setup.ts", "**/authed/**"],
		},
		// One-shot setup that signs up a fresh user via the real form and
		// writes the cookies to STORAGE_STATE for the authenticated project
		// to consume. Runs before "authenticated" thanks to the dependency.
		{
			name: "setup",
			use: { ...devices["Desktop Chrome"] },
			testMatch: /auth\.setup\.ts/,
		},
		{
			name: "authenticated",
			use: {
				...devices["Desktop Chrome"],
				storageState: STORAGE_STATE,
			},
			// Direct children of e2e/authed/ only — e2e/authed/mobile/ is owned
			// by the mobile-authenticated project below.
			testMatch: /authed\/[^/]+\.spec\.ts$/,
			dependencies: ["setup"],
		},
		// Same authenticated session, but a mobile-Chromium viewport so the
		// mobile shell, sheets, and view replacements get exercised through
		// real touch-sized chrome. Pixel 7 (412×915, Chrome on Android) is
		// used rather than iPhone 14 because the latter pulls in WebKit and
		// doubles browser-install time; the mobile UI is not iOS-specific.
		// If iOS-only behaviour later matters, add a second project on
		// `devices['iPhone 14']`.
		{
			name: "mobile-authenticated",
			use: {
				...devices["Pixel 7"],
				storageState: STORAGE_STATE,
			},
			testMatch: /authed\/mobile\/.*\.spec\.ts$/,
			dependencies: ["setup"],
		},
	],
	webServer: {
		command: `pnpm exec vite dev --port ${E2E_PORT}`,
		url: `http://localhost:${E2E_PORT}`,
		// Always start fresh — sidesteps port contention with a developer's
		// running dev server and gives the test run a known-clean env.
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			// PGLite handles all DB traffic in-process — DATABASE_URL is unused
			// but better set to a placeholder so module-load checks don't trip.
			DATABASE_URL:
				process.env.DATABASE_URL ??
				"postgresql://noop:noop@127.0.0.1:1/noop?sslmode=disable",
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ??
				"e2e-only-not-a-real-secret-0000000000000000",
			VITE_NEON_DISABLE: "1",
			// Skip the Automerge sync WebSocket. Per-tab BroadcastChannel is
			// still on; UI tests don't need cross-context replication.
			VITE_E2E_DISABLE_SYNC: "1",
			// Use in-process Postgres (PGLite) so workspace / project /
			// audit-log queries work without provisioning Neon. See src/db/index.ts.
			E2E_PGLITE: "1",
			// Better-auth's CSRF check rejects non-GET requests whose Origin
			// doesn't match BETTER_AUTH_URL. Point it at the e2e port so the
			// sign-up POST from /signin is accepted.
			BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
			PORT: String(E2E_PORT),
		},
	},
});

import { defineConfig, devices } from "@playwright/test";

// End-to-end tests live in `./e2e`. They drive the real app through Chromium
// against a Playwright-managed dev server on port 3100 (so it never fights
// the developer's `pnpm dev` on 3000). The current suite covers public
// surfaces only — welcome, signin, privacy, cookie hint — none of which
// query the database, so we pass a placeholder DATABASE_URL purely to
// satisfy the lazy db client at module load. The neon-http driver doesn't
// actually connect until a query is made; if a future test needs auth,
// swap this for PGLite or a disposable Neon branch.
const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

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
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
			// Stub values so server modules that read env at import don't crash.
			// The neon driver is lazy, so a never-resolved URL is fine as long
			// as no test triggers an actual query.
			DATABASE_URL:
				process.env.DATABASE_URL ??
				"postgresql://noop:noop@127.0.0.1:1/noop?sslmode=disable",
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ??
				"e2e-only-not-a-real-secret-0000000000000000",
			// Skip the neon-launchpad provisioning on this port.
			VITE_NEON_DISABLE: "1",
			// Skip the Automerge sync WebSocket — without a real DB the
			// upgrade handshake (which validates a session) crashes the dev
			// server's proxy. Public-surface tests don't need real-time sync.
			VITE_E2E_DISABLE_SYNC: "1",
		},
	},
});

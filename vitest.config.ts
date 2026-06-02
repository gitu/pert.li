import { defineConfig } from "vitest/config";

// Dedicated vitest config so the nitro + tanstack-start plugins from the root
// vite.config.ts don't try to attach to a non-existent dev server. Mirrors the
// approach used in `.storybook/vite.config.ts`.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: [
			"src/**/*.test.{ts,tsx}",
			// Loose ops scripts (CI helpers) live under scripts/ and ship as
			// plain ESM so they can run via `node` from CI yaml. Their tests
			// live next to them — pick them up too.
			"scripts/**/*.test.mjs",
		],
		// Repairs the localStorage / sessionStorage globals that node's
		// experimental Web Storage API shadows in jsdom environments. See the
		// comment in the setup file.
		setupFiles: ["./src/test/setup-dom.ts"],
	},
});

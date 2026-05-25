import { defineConfig } from "vitest/config";

// Dedicated vitest config so the nitro + tanstack-start plugins from the root
// vite.config.ts don't try to attach to a non-existent dev server. Mirrors the
// approach used in `.storybook/vite.config.ts`.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});

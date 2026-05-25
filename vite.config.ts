import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import neon from "./neon-vite-plugin.ts";

// Vite only injects VITE_-prefixed env into the client. Server-side process.env
// is whatever Node inherits, which doesn't include `.env.local` by default.
// Load both `.env` and `.env.local` (local wins) so handlers see the keys.
// Also stash the resolved project root so the nitro dev worker (separate
// process, different cwd) can find the same files at module init.
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
process.env.PROJECT_ROOT = process.cwd();

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	optimizeDeps: {
		// Pulling server-only chains (better-auth, drizzle, jose, kysely) into
		// the client dep scanner forces vite to re-bundle @tanstack/router-core
		// and drops `isInlinableStylesheet` from the optimized chunk. Skip
		// pre-bundling router-core — it's ESM and doesn't need optimization.
		exclude: ["@tanstack/router-core"],
	},
	plugins: [
		devtools(),
		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			features: { websocket: true },
			handlers: [{ route: "/sync", handler: "./src/server/sync.ts" }],
		}),
		neon,
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		wasm(),
		babel({ presets: [reactCompilerPreset()] }),
	],
	worker: {
		format: "es",
		plugins: () => [wasm()],
	},
});

export default config;

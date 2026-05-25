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
import pglitePreWarm from "./pglite-vite-plugin.ts";

// Vite only injects VITE_-prefixed env into the client. Server-side process.env
// is whatever Node inherits, which doesn't include `.env.local` by default.
// Load both `.env` and `.env.local` (local wins) so handlers see the keys.
// Also stash the resolved project root so the nitro dev worker (separate
// process, different cwd) can find the same files at module init.
//
// Exception: in e2e mode the Playwright harness sets a complete, opinionated
// env via `webServer.env`. We must not let a developer's `.env.local` (with
// e.g. a Neon URL, a low-entropy BETTER_AUTH_SECRET, or real LLM API keys)
// override those values — both for correctness (the harness is supposed to
// run against PGLite) and to keep tests deterministic across machines.
const isE2E = process.env.E2E_PGLITE === "1" || process.env.VITE_E2E === "1";
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: !isE2E, quiet: true });
process.env.PROJECT_ROOT = process.cwd();

// Default first-run experience uses an in-process Postgres (PGLite) on disk,
// so `pnpm dev` works zero-config. To use Neon's launchpad provisioning set
// USE_NEON_PROVISION=1 (or just drop a DATABASE_URL into .env.local — the
// neon plugin will detect it and skip).
const useNeonProvisioning = process.env.USE_NEON_PROVISION === "1";

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
			// `@automerge/automerge`'s ESM build references CJS-only `__dirname`
			// when resolving its wasm side-file. Bundling that into the Nitro
			// node-server output crashes at startup ("__dirname is not defined
			// in ES module scope"). Keeping it external means Nitro copies the
			// package — wasm and all — into .output/server/node_modules/ and
			// the runtime resolves the path via real `node_modules`.
			rollupConfig: {
				external: [/^@sentry\//, /^@automerge\//],
			},
			features: { websocket: true },
			handlers: [{ route: "/sync", handler: "./src/server/sync.ts" }],
		}),
		...(useNeonProvisioning ? [neon] : []),
		pglitePreWarm(),
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

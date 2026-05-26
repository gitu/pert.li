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
	build: { target: ["chrome111", "edge111", "firefox114", "safari16.4"] },
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
		wasm(),
		nitro({
			// `@electric-sql/pglite` resolves `postgres.wasm` / `initdb.wasm`
			// relative to `import.meta.url`. Once rollup inlines pglite into
			// `_libs/_8.mjs` the wasm sidecars are nowhere to be found and
			// `node .output/server/index.mjs` hangs forever on the PGLite
			// schema push. Externalizing pulls the package (wasm and all)
			// through Nitro's node_modules so Node's normal resolution finds
			// them.
			//
			// `@automerge/*` is the same story for a related reason — it ships
			// a `.wasm` side-file and additionally uses CJS `__dirname` to find
			// it, which crashes the ESM Nitro output if bundled inline. Letting
			// Node resolve through `node_modules` keeps the wasm reachable.
			//
			// `drizzle-kit/api` re-exports every Drizzle driver (mysql2,
			// aws-data-api, vercel-postgres, …) — most have optional peer
			// deps that aren't installed here, so following the chain at
			// build time trips MISSING_EXPORT errors. The `/* @vite-ignore */`
			// hint in src/db/index.ts is honored by Vite's client bundler but
			// not by Rolldown on the server side, so we externalize the whole
			// package here.
			rollupConfig: {
				external: [/^@electric-sql\//, /^@automerge\//, /^drizzle-kit(\/|$)/],
			},
			features: { websocket: true },
			handlers: [{ route: "/sync", handler: "./src/server/sync.ts" }],
		}),
		...(useNeonProvisioning ? [neon] : []),
		pglitePreWarm(),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
	],
	worker: {
		format: "es",
		plugins: () => [wasm()],
	},
});

export default config;

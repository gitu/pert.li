import type { Plugin } from "vite";

// Pre-warms the local PGLite database during `configureServer` so the
// schema push (~500ms) completes before Vite starts accepting connections.
//
// Without this, top-level await in src/db/index.ts blocks the SSR module
// graph for the duration of the schema push. During that window Vite's HMR
// client opens a WebSocket upgrade through Nitro's proxy, the proxy can't
// forward to the not-yet-loaded SSR handler, and httpxy throws "Upstream
// server did not upgrade the connection" — crashing the dev process.
//
// Running the init from `configureServer` is the cleanest fix: Vite waits
// for the hook's returned promise before listening, so PGLite is ready by
// the time HMR upgrades arrive. No-op when not using local PGLite.
export default function pglitePreWarmPlugin(): Plugin {
	return {
		name: "pertli:pglite-prewarm",
		async configureServer() {
			const useLocalPglite =
				process.env.LOCAL_PGLITE === "1" ||
				!process.env.DATABASE_URL ||
				process.env.DATABASE_URL.trim() === "";
			if (!useLocalPglite) return;
			if (process.env.E2E_PGLITE === "1") return; // handled by TLA in db/index.ts
			const { ensureDb } = await import("./src/db/index.ts");
			await ensureDb();
		},
	};
}

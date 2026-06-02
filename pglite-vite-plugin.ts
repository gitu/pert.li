import type { Plugin } from "vite";

// Pre-warms the local PGLite database during `configureServer` so the data
// dir exists and the schema push (~500ms) completes before Vite starts
// accepting connections.
//
// This plugin runs in the Vite main process; request handlers run in the
// nitro dev worker, which evaluates src/db/index.ts in its own module graph
// and opens its own PGLite on the same data dir (via top-level await there).
// The pre-warm can't share its instance with the worker — its job is only to
// make the worker's init fast: by the time the first request arrives, the
// dir exists and the schema is current, so the worker's top-level await is a
// quick open + no-op diff instead of a cold multi-second init racing Vite's
// HMR WebSocket upgrade ("Upstream server did not upgrade the connection").
//
// The pre-warm instance is closed right after the push so the worker's
// instance is the only one holding the data dir open.
// No-op when not using local PGLite.
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
			const { ensureDb, closeDb } = await import("./src/db/index.ts");
			await ensureDb();
			await closeDb();
		},
	};
}

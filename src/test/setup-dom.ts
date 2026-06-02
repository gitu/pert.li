// Node ≥25 ships an experimental Web Storage API: globalThis carries lazy
// `localStorage` / `sessionStorage` getters that return undefined (plus an
// ExperimentalWarning) unless node is started with --localstorage-file.
//
// Vitest's jsdom environment copies window properties onto globalThis but
// skips keys that already exist on the global unless they're in its KEYS
// whitelist — and that whitelist predates node's webstorage globals. The
// result: in `@vitest-environment jsdom` files, `window.localStorage` is
// node's broken getter (undefined) instead of jsdom's working storage, and
// every test that touches storage explodes.
//
// Repair: vitest exposes the raw JSDOM instance as `globalThis.jsdom` in its
// jsdom environment. Rewire the storage globals to the jsdom window's
// implementations. No-op in node-environment test files and on node versions
// without the webstorage globals.

const g = globalThis as Record<string, unknown> & {
	jsdom?: { window?: Record<string, unknown> };
};
const domWindow = g.jsdom?.window;

if (domWindow) {
	for (const key of ["localStorage", "sessionStorage"]) {
		// Unconditional override: reading the existing global would invoke
		// node's lazy getter (emitting its ExperimentalWarning), and if the
		// global is already jsdom's this is a harmless re-pointing.
		if (domWindow[key]) {
			Object.defineProperty(globalThis, key, {
				get: () => domWindow[key],
				configurable: true,
				enumerable: true,
			});
		}
	}
}

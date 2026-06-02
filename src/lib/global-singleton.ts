// Anchors lazily-created singletons on globalThis so every module graph in
// the process shares one instance.
//
// Why this exists: the dev server evaluates server modules in MULTIPLE Vite
// module graphs (the SSR/API graph and the Nitro websocket graph). A plain
// module-level `let _instance` singleton gets duplicated per graph — which is
// how the Automerge server repo and the PGLite database ended up as parallel
// instances with diverging state: documents created through the HTTP API were
// invisible to the sync handler, and sessions created through the HTTP API
// were invisible to websocket auth. In production builds there is exactly one
// module graph, so this pattern is a no-op safety net there.
//
// Keys go through Symbol.for(), i.e. the process-wide symbol registry — two
// module graphs calling globalSingleton with the same key get the same slot.

const PREFIX = "pertli.singleton.";

export function globalSingleton<T>(key: string, create: () => T): T {
	const sym = Symbol.for(`${PREFIX}${key}`);
	const g = globalThis as unknown as Record<symbol, T | undefined>;
	let value = g[sym];
	if (value === undefined) {
		value = create();
		g[sym] = value;
	}
	return value;
}

// Removes a singleton so the next globalSingleton() call re-creates it.
// Used by teardown paths (closing the dev PGLite instance) and tests.
export function clearGlobalSingleton(key: string): void {
	const sym = Symbol.for(`${PREFIX}${key}`);
	const g = globalThis as unknown as Record<symbol, unknown>;
	delete g[sym];
}

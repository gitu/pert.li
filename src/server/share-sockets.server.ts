// In-memory registry of currently-connected share peers, keyed by shareId.
// Populated by the `/sync` upgrade handler when a share token authenticates;
// drained when the socket closes. `revokeShare` reads from here to close
// any matching sockets so a revoked link disconnects within milliseconds
// rather than persisting until the recipient's socket happens to drop.
//
// Lives in its own file (instead of inside `automerge-server.server.ts`) so
// `project-share-store.server.ts` can import it without pulling in the WS
// adapter, the Repo, or the storage adapter — all heavy and unnecessary
// for the store layer's DB-only operations.

import { globalSingleton } from "#/lib/global-singleton";

type ClosableSocket = { close: () => void };

// Anchored on globalThis: sockets are registered by the websocket handler's
// module graph but closed (on revoke) from the HTTP API's module graph — a
// plain module-level Map would give each graph its own empty registry.
const sockets = globalSingleton(
	"share-sockets",
	() => new Map<string, Set<ClosableSocket>>(),
);

export function registerShareSocket(shareId: string, sock: ClosableSocket) {
	const set = sockets.get(shareId);
	if (set) {
		set.add(sock);
	} else {
		sockets.set(shareId, new Set([sock]));
	}
}

export function unregisterShareSocket(shareId: string, sock: ClosableSocket) {
	const set = sockets.get(shareId);
	if (!set) return;
	set.delete(sock);
	if (set.size === 0) sockets.delete(shareId);
}

export function closeShareSockets(shareId: string) {
	const set = sockets.get(shareId);
	if (!set) return;
	for (const sock of set) {
		try {
			sock.close();
		} catch {
			// Ignore — close may race with the socket's own teardown.
		}
	}
	sockets.delete(shareId);
}

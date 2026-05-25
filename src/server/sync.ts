import { defineWebSocketHandler } from "nitro";
import { auth } from "#/lib/auth.server.ts";
import {
	getServerRepoBundle,
	type PeerLike,
	PeerSocket,
} from "./automerge-server.server.ts";

// crossws may give us a fresh `peer.context` object per hook invocation, so
// thread the PeerSocket through a module-level Map keyed by peer.id instead.
const peerSockets = new Map<string, PeerSocket>();

// crossws fires `message` synchronously the moment the client sends data, but
// our `open` hook is async (Better Auth session validation). Buffer messages
// that arrive before the PeerSocket is registered and replay once it is.
const pendingMessages = new Map<string, Buffer[]>();

function getPeerId(peer: unknown): string {
	return String((peer as { id?: unknown }).id ?? "");
}

// Validate the Better Auth session from the upgrade headers. crossws hands us
// the underlying request via `peer.request` (Node) — fall back to building a
// minimal Headers from `peer.headers` when only the latter is available.
async function authenticatePeer(
	peer: unknown,
): Promise<{ userId: string } | null> {
	const headers = extractRequestHeaders(peer);
	if (!headers) return null;
	try {
		const session = await auth.api.getSession({ headers });
		if (!session?.user?.id) return null;
		return { userId: session.user.id };
	} catch {
		return null;
	}
}

function extractRequestHeaders(peer: unknown): Headers | null {
	const p = peer as {
		request?: Request | { headers?: Headers | Record<string, string> };
		headers?: Headers | Record<string, string>;
	};
	const raw = p.request?.headers ?? p.headers;
	if (!raw) return null;
	if (raw instanceof Headers) return raw;
	const h = new Headers();
	for (const [k, v] of Object.entries(raw)) h.set(k, String(v));
	return h;
}

export default defineWebSocketHandler({
	// No `upgrade` hook on purpose: Vite's dev HTTP proxy (httpxy) crashes the
	// Node process with an unhandled rejection when an upstream WS upgrade is
	// answered with a non-101 status, so returning 401 here would take down
	// the dev server on the first unauthenticated /sync attempt. The `open`
	// hook below already validates the session and closes the socket on
	// failure, which is sufficient — an unauthenticated client just sees the
	// connection close immediately.

	async open(peer) {
		const id = getPeerId(peer);
		const session = await authenticatePeer(peer);
		if (!session) {
			pendingMessages.delete(id);
			peer.close();
			return;
		}
		const sock = new PeerSocket(peer as unknown as PeerLike);
		sock.userId = session.userId;
		peerSockets.set(id, sock);
		const { wss } = getServerRepoBundle();
		wss.clients.add(sock);
		wss.emit("connection", sock);
		const queued = pendingMessages.get(id);
		if (queued && queued.length > 0) {
			pendingMessages.delete(id);
			for (const buf of queued) sock.emit("message", buf);
		}
	},

	message(peer, message) {
		const id = getPeerId(peer);
		const buf = Buffer.from(message.uint8Array());
		const sock = peerSockets.get(id);
		if (sock) {
			sock.isAlive = true;
			sock.emit("message", buf);
			return;
		}
		// open hasn't resolved yet — buffer until it does.
		const queue = pendingMessages.get(id);
		if (queue) queue.push(buf);
		else pendingMessages.set(id, [buf]);
	},

	close(peer) {
		const id = getPeerId(peer);
		pendingMessages.delete(id);
		const sock = peerSockets.get(id);
		if (!sock) return;
		peerSockets.delete(id);
		const { wss } = getServerRepoBundle();
		wss.clients.delete(sock);
		sock.emit("close");
	},

	error(peer, error) {
		const sock = peerSockets.get(getPeerId(peer));
		if (sock) sock.emit("error", error);
	},
});

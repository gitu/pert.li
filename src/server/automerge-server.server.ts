import { EventEmitter } from "node:events";
import {
	type DocumentId,
	type PeerId,
	Repo,
	type StorageAdapterInterface,
} from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { globalSingleton } from "#/lib/global-singleton";
import { PostgresStorageAdapter } from "./automerge-pg-storage.server";
import { userCanWriteDoc } from "./workspace-store.server";

// --- crossws ⇄ ws-shaped server shim --------------------------------------
//
// WebSocketServerAdapter expects a `ws`-shaped WebSocketServer
// (`server.on("connection", socket => ...)`; sockets with `.on(...)`, `.send`,
// `.isAlive`, `.ping`, `.terminate`). Crossws gives us one peer per event, so
// we synthesize the server/socket surface here.

export type PeerLike = {
	send: (data: Uint8Array | ArrayBuffer | string) => void;
	close: () => void;
	context: Record<string, unknown>;
};

export class PeerSocket extends EventEmitter {
	binaryType: "nodebuffer" | "arraybuffer" = "nodebuffer";
	isAlive = true;
	userId: string | null = null;
	// Share-link peers are scoped to a single document; `shareDocUrl` holds
	// the only Automerge URL they're allowed to subscribe to. `shareMode`
	// controls whether the client UI exposes edit affordances. Server-side
	// write enforcement is intentionally minimal in this iteration — the
	// share dialog warns owners that view-mode trusts the recipient not to
	// bypass the UI.
	shareDocUrl: string | null = null;
	shareMode: "view" | "edit" | null = null;
	// Populated for share-link peers so the share-sockets registry can match
	// on revoke and the sharePolicy can re-check expiry without a DB round
	// trip on every doc subscription.
	shareId: string | null = null;
	shareExpiresAt: Date | null = null;
	constructor(private peer: PeerLike) {
		super();
	}
	send(data: Uint8Array | ArrayBuffer | string, cb?: (err?: Error) => void) {
		try {
			this.peer.send(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
			cb?.();
		} catch (err) {
			cb?.(err as Error);
		}
	}
	ping() {
		this.isAlive = true;
	}
	terminate() {
		try {
			this.peer.close();
		} catch {}
	}
	close() {
		try {
			this.peer.close();
		} catch {}
	}
}

class FakeWebSocketServer extends EventEmitter {
	clients = new Set<PeerSocket>();

	// Resolves once the WebSocketServerAdapter has attached its "connection"
	// handler. The adapter attaches it asynchronously — Repo construction kicks
	// off `adapter.connect()` only after the storage subsystem's id has been
	// read from disk — so a peer that connects while the bundle is still
	// initialising must wait for this before `emit("connection")`. Emitting
	// earlier sends the event (and the client's buffered join message) into the
	// void: the socket stays open but the server never answers, and the client
	// waits forever.
	readonly listening: Promise<void>;

	constructor() {
		super();
		this.listening = new Promise((resolve) => {
			this.on("newListener", (event) => {
				if (event === "connection") resolve();
			});
		});
	}
}

// --- Repo singleton --------------------------------------------------------

type ServerRepoBundle = {
	repo: Repo;
	adapter: WebSocketServerAdapter;
	wss: FakeWebSocketServer;
};

function buildBundle(): ServerRepoBundle {
	const wss = new FakeWebSocketServer();
	const adapter = new WebSocketServerAdapter(wss as unknown as never);
	const { storage, storageLabel } = resolveStorage();

	const repo = new Repo({
		network: [adapter],
		storage,
		peerId: `sync-server-${process.pid}` as PeerId,
		sharePolicy: async (peerId, documentId) => {
			if (!documentId) return false;
			const socket = adapter.sockets[peerId] as PeerSocket | undefined;
			if (!socket) return false;
			// Share-link peer: only ever expose the one doc they hold a token
			// for, and only while the token is still live. The expiry check
			// here catches "token expired mid-session" without requiring a DB
			// roundtrip on the hot path; revocation is handled separately by
			// closing matching sockets from `revokeShare`.
			if (socket.shareDocUrl) {
				if (
					socket.shareExpiresAt &&
					socket.shareExpiresAt.getTime() <= Date.now()
				) {
					return false;
				}
				return `automerge:${documentId}` === socket.shareDocUrl;
			}
			if (!socket.userId) return false;
			return userCanAccessDoc(socket.userId, documentId);
		},
	});

	if (process.env.NODE_ENV !== "production") {
		console.log(
			`[sync] Automerge sync server ready (storage: ${storageLabel})`,
		);
	}

	return { repo, adapter, wss };
}

// Storage selection:
//  - In production (NODE_ENV=production) we ALWAYS use Postgres — the
//    filesystem on Cloud Run / Fly machines is ephemeral, so NodeFS would
//    silently lose collaborative state on every cold start.
//  - In dev, default to NodeFS (no DB roundtrip per write, easier to nuke).
//    Override with AUTOMERGE_STORAGE=postgres to mirror prod locally.
function resolveStorage(): {
	storage: StorageAdapterInterface;
	storageLabel: string;
} {
	const choice =
		process.env.AUTOMERGE_STORAGE ??
		(process.env.NODE_ENV === "production" ? "postgres" : "nodefs");
	if (choice === "postgres") {
		return {
			storage: new PostgresStorageAdapter(),
			storageLabel: "postgres (automerge_storage)",
		};
	}
	const storageDir = process.env.AUTOMERGE_STORAGE_DIR ?? ".data/automerge";
	return {
		storage: new NodeFSStorageAdapter(storageDir),
		storageLabel: `nodefs (${storageDir})`,
	};
}

// Anchored on globalThis (not a module-level variable): the dev server's
// HTTP/API module graph and the websocket handler's module graph must share
// ONE repo. With two instances, documents created through server fns (project
// create / import / fork) lived only in the HTTP graph's repo, so the sync
// handler could never deliver them — the browser waited on "Loading document…"
// forever and every chat tool failed with "No active project".
export function getServerRepoBundle(): ServerRepoBundle {
	return globalSingleton("automerge-server-repo", buildBundle);
}

export function getServerRepo(): Repo {
	return getServerRepoBundle().repo;
}

// --- sharePolicy helpers --------------------------------------------------

// Kept for potential future use; sharePolicy now reads the socket directly to
// also see share-mode peers.
function lookupUserIdForPeer(
	adapter: WebSocketServerAdapter,
	peerId: PeerId,
): string | null {
	const socket = adapter.sockets[peerId] as PeerSocket | undefined;
	return socket?.userId ?? null;
}
void lookupUserIdForPeer;

// sharePolicy is the only gate the Automerge sync server has. Once a peer is
// admitted to a doc, the protocol grants it full read+write — there's no
// per-peer read-only mode. Delegate to userCanWriteDoc so the role check
// (viewer ⇒ blocked) and the auth check live in one place; the store-level
// tests cover the matrix.
async function userCanAccessDoc(
	userId: string,
	documentId: DocumentId,
): Promise<boolean> {
	return userCanWriteDoc(userId, `automerge:${documentId}`);
}

import { EventEmitter } from "node:events";
import {
	type DocumentId,
	type PeerId,
	Repo,
	type StorageAdapterInterface,
} from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { project, userWorkspaceDoc, workspaceMember } from "#/db/schema";
import { PostgresStorageAdapter } from "./automerge-pg-storage.server";

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
}

// --- Repo singleton --------------------------------------------------------

type ServerRepoBundle = {
	repo: Repo;
	adapter: WebSocketServerAdapter;
	wss: FakeWebSocketServer;
};

let _bundle: ServerRepoBundle | undefined;

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

export function getServerRepoBundle(): ServerRepoBundle {
	if (!_bundle) _bundle = buildBundle();
	return _bundle;
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

async function userCanAccessDoc(
	userId: string,
	documentId: DocumentId,
): Promise<boolean> {
	const docUrl = `automerge:${documentId}`;

	const owned = await db
		.select({ url: userWorkspaceDoc.automergeDocUrl })
		.from(userWorkspaceDoc)
		.where(
			and(
				eq(userWorkspaceDoc.userId, userId),
				eq(userWorkspaceDoc.automergeDocUrl, docUrl),
			),
		)
		.limit(1);
	if (owned.length > 0) return true;

	const projectAccess = await db
		.select({ id: project.id })
		.from(project)
		.innerJoin(
			workspaceMember,
			eq(workspaceMember.workspaceId, project.workspaceId),
		)
		.where(
			and(
				eq(workspaceMember.userId, userId),
				eq(project.automergeDocUrl, docUrl),
			),
		)
		.limit(1);
	return projectAccess.length > 0;
}

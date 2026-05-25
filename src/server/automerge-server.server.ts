import { EventEmitter } from "node:events";
import { type DocumentId, type PeerId, Repo } from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { project, userWorkspaceDoc, workspaceMember } from "#/db/schema";

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
	const storageDir = process.env.AUTOMERGE_STORAGE_DIR ?? ".data/automerge";

	const repo = new Repo({
		network: [adapter],
		storage: new NodeFSStorageAdapter(storageDir),
		peerId: `sync-server-${process.pid}` as PeerId,
		sharePolicy: async (peerId, documentId) => {
			if (!documentId) return false;
			const userId = lookupUserIdForPeer(adapter, peerId);
			if (!userId) return false;
			return userCanAccessDoc(userId, documentId);
		},
	});

	if (process.env.NODE_ENV !== "production") {
		console.log(`[sync] Automerge sync server ready (storage: ${storageDir})`);
	}

	return { repo, adapter, wss };
}

export function getServerRepoBundle(): ServerRepoBundle {
	if (!_bundle) _bundle = buildBundle();
	return _bundle;
}

export function getServerRepo(): Repo {
	return getServerRepoBundle().repo;
}

// --- sharePolicy helpers --------------------------------------------------

function lookupUserIdForPeer(
	adapter: WebSocketServerAdapter,
	peerId: PeerId,
): string | null {
	const socket = adapter.sockets[peerId] as PeerSocket | undefined;
	return socket?.userId ?? null;
}

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

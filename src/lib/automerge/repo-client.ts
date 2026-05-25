import { Repo } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";

let _repo: Repo | undefined;

export function getBrowserRepo(): Repo {
	if (_repo) return _repo;
	if (typeof window === "undefined") {
		throw new Error("getBrowserRepo() called outside the browser");
	}
	// In e2e mode we skip the WebSocket adapter entirely. The sync upgrade
	// path needs a real cross-worker DB; in PGLite e2e each Nitro worker has
	// its own in-memory PGLite, so the WS handler's session lookup misses the
	// signup row that the API handler wrote. UI tests that need to see the
	// doc materialize aren't shipping in this iteration — Phase 5's sync
	// spec will land once cross-worker DB sharing exists.
	const disableSync = import.meta.env.VITE_E2E_DISABLE_SYNC === "1";
	const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/sync`;
	_repo = new Repo({
		network: disableSync
			? [new BroadcastChannelNetworkAdapter()]
			: [
					new BroadcastChannelNetworkAdapter(),
					new WebSocketClientAdapter(wsUrl),
				],
		storage: new IndexedDBStorageAdapter("pert.li"),
	});
	return _repo;
}

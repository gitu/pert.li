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
	const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/sync`;
	_repo = new Repo({
		network: [
			new BroadcastChannelNetworkAdapter(),
			new WebSocketClientAdapter(wsUrl),
		],
		storage: new IndexedDBStorageAdapter("pert.li"),
	});
	return _repo;
}

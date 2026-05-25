import { Store } from "@tanstack/store";
import type { TaskId } from "#/lib/pert/types";

// Pure presence store + selectors. Lives in its own module (no Automerge
// imports) so Storybook stories and unit tests can exercise the rendering
// without dragging the wasm-backed Automerge runtime along.

export type PresenceSelectionState = {
	userId: string;
	displayName: string | null;
	selectedTaskId: TaskId | null;
};

export type PeerRecord = PresenceSelectionState & {
	// Repo-local peer id. Two tabs from the same user have different peer
	// ids but the same userId, so we collapse them on render.
	peerId: string;
};

export type PresenceStoreState = {
	projectId: string | null;
	peers: PeerRecord[];
};

export const presenceStore = new Store<PresenceStoreState>({
	projectId: null,
	peers: [],
});

// Distinct peers (by userId) whose current selection is the given task. Used
// by view rendering to draw badges on rows / cards.
export function peersOnTask(state: PresenceStoreState, taskId: TaskId | null) {
	if (!taskId) return [] as PeerRecord[];
	const out: PeerRecord[] = [];
	const seen = new Set<string>();
	for (const peer of state.peers) {
		if (peer.selectedTaskId !== taskId) continue;
		if (seen.has(peer.userId)) continue;
		seen.add(peer.userId);
		out.push(peer);
	}
	return out;
}

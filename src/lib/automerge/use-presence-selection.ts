import type { DocHandle } from "@automerge/automerge-repo";
import { usePresence } from "@automerge/automerge-repo-react-hooks";
import { useEffect } from "react";
import type { PertDoc, TaskId } from "#/lib/pert/types";
import {
	type PeerRecord,
	type PresenceSelectionState,
	presenceStore,
} from "./presence-store";

// Presence layer on top of the project doc. Every browser tab broadcasts a
// tiny payload to peers connected to the same doc:
//
//   { userId, displayName, selectedTaskId }
//
// `userId` is a stable hash of the signed-in user — it's what we colour
// swatches by, so the same person across two tabs reads as a single
// collaborator instead of two strangers. Peers' states land in
// `presenceStore` so any view (canvas, table, matrix) can render badges
// without re-wiring the Automerge plumbing each time.

export type UsePresenceSelectionOptions = {
	projectId: string;
	userId: string;
	displayName: string | null;
	selectedTaskId: TaskId | null;
	handle: DocHandle<PertDoc>;
};

// One call site (the active project route). Subscribes to peer broadcasts and
// keeps the global presenceStore in sync; also broadcasts the local
// selection back out.
export function usePresenceSelection({
	projectId,
	userId,
	displayName,
	selectedTaskId,
	handle,
}: UsePresenceSelectionOptions): void {
	// `usePresence` returns a fresh wrapper object every render but its
	// `update` callback and `peerStates` React state are individually
	// stable — depend on those, never on the whole `presence` value, or the
	// rebroadcast effect feedback-loops itself to infinity.
	const { peerStates, update } = usePresence<{
		selection: PresenceSelectionState;
	}>({
		handle,
		initialState: {
			selection: { userId, displayName, selectedTaskId },
		},
		heartbeatMs: 5_000,
		peerTtlMs: 15_000,
	});

	// Rebroadcast selection whenever it changes.
	useEffect(() => {
		update("selection", {
			userId,
			displayName,
			selectedTaskId,
		});
	}, [update, userId, displayName, selectedTaskId]);

	// Push remote peer selections into the cross-view store. Skip our own
	// (the Repo sometimes echoes back over BroadcastChannel; filtering by
	// userId is stable across reloads, peer id isn't).
	useEffect(() => {
		const next: PeerRecord[] = [];
		for (const peerId of Object.keys(peerStates)) {
			const sel = peerStates[peerId]?.selection;
			if (!sel) continue;
			if (sel.userId === userId) continue;
			next.push({
				peerId,
				userId: sel.userId,
				displayName: sel.displayName ?? null,
				selectedTaskId: sel.selectedTaskId ?? null,
			});
		}
		presenceStore.setState({ projectId, peers: next });
	}, [peerStates, projectId, userId]);

	// Clear the cross-view store when the active project changes or the
	// hook unmounts so stale peers don't linger on an unrelated view.
	useEffect(() => {
		return () => {
			presenceStore.setState((s) =>
				s.projectId === projectId ? { projectId: null, peers: [] } : s,
			);
		};
	}, [projectId]);
}

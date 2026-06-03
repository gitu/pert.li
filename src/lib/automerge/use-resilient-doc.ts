import type {
	AnyDocumentId,
	ChangeFn,
	Doc,
	DocHandle,
} from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { useCallback, useEffect, useState } from "react";

// Drop-in replacement for the library's useDocument/useDocHandle pair, built
// for resilience on slow or flaky sync connections.
//
// Why not useDocument/useDocHandle? Their implementation (v2.5.6) caches the
// repo.find() promise in a MODULE-LEVEL map keyed by document id. When that
// find fails — the doc isn't in IndexedDB yet and the sync socket takes
// longer than the 60s unavailable timeout (auth round-trip, server cold
// start), or the find gets aborted by a quick project switch — the rejected
// promise is cached forever. Even after the sync server connects and delivers
// the doc, the page keeps showing "Loading document…" until a full reload,
// with the websocket sitting idle. This hook:
//   • never caches failures — every mount/retry runs a fresh find,
//   • treats "unavailable" as a state, not an error (allowableStates),
//   • keeps listening — an unavailable doc flips to ready the moment any
//     peer delivers it (the sync server re-syncs registered docs whenever a
//     connection is established).

export type ResilientDocState = "loading" | "ready" | "unavailable";

export type ResilientDoc<T> = {
	doc: Doc<T> | undefined;
	changeDoc: (fn: ChangeFn<T>) => void;
	handle: DocHandle<T> | undefined;
	state: ResilientDocState;
	// Starts a fresh find. Unavailable docs already self-heal when a peer
	// delivers them; retry exists for the user who wants to force the issue.
	retry: () => void;
};

export function useResilientDoc<T>(
	documentId: AnyDocumentId | undefined,
): ResilientDoc<T> {
	const repo = useRepo();
	const [attempt, setAttempt] = useState(0);
	const [handle, setHandle] = useState<DocHandle<T> | undefined>(undefined);
	const [state, setState] = useState<ResilientDocState>("loading");
	const [doc, setDoc] = useState<Doc<T> | undefined>(undefined);

	// Phase 1 — resolve the handle. allowableStates turns "unavailable" into a
	// resolved value instead of a rejection, so there is nothing to poison.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a retry trigger — bumping it forces a fresh find even though the body doesn't read it.
	useEffect(() => {
		if (!documentId) {
			// Clear rather than return early: a caller that briefly passes
			// undefined (route/query transitions) must not keep rendering the
			// previous document's content.
			setHandle(undefined);
			setDoc(undefined);
			setState("loading");
			return;
		}
		let cancelled = false;
		setHandle(undefined);
		setDoc(undefined);
		setState("loading");
		void (async () => {
			try {
				const found = await repo.find<T>(documentId, {
					allowableStates: ["ready", "unavailable"],
				});
				if (cancelled) return;
				setHandle(found);
			} catch {
				// Malformed URL or deleted doc — nothing to keep waiting for.
				if (cancelled) return;
				setState("unavailable");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [repo, documentId, attempt]);

	// Phase 2 — mirror the handle's lifecycle into React state and keep
	// listening until the doc is actually delivered.
	useEffect(() => {
		if (!handle) return;
		let cancelled = false;
		const sync = () => {
			if (cancelled) return;
			if (handle.isReady()) {
				setState("ready");
				setDoc(handle.doc());
			} else if (handle.isUnavailable()) {
				setState("unavailable");
			} else {
				setState("loading");
			}
		};
		sync();
		const onChange = () => sync();
		handle.on("change", onChange);
		handle.on("heads-changed", onChange);
		// Self-healing wait. whenReady() rejects on an internal 60s timeout
		// while the doc stays unavailable, so loop until it's ready or we
		// unmount — each iteration is one timeout window.
		void (async () => {
			while (!cancelled && !handle.isReady()) {
				try {
					await handle.whenReady(["ready"]);
				} catch {
					// Timed out — the doc is still unavailable. Keep waiting; the
					// sync server delivers registered docs as soon as it connects.
				}
			}
			sync();
		})();
		return () => {
			cancelled = true;
			handle.off("change", onChange);
			handle.off("heads-changed", onChange);
		};
	}, [handle]);

	const changeDoc = useCallback(
		(fn: ChangeFn<T>) => {
			// Mirrors useDocument's behaviour: changes before the doc is ready
			// are dropped (callers all guard on `doc` being present anyway).
			if (!handle) return;
			if (!handle.isReady()) return;
			handle.change(fn);
		},
		[handle],
	);

	const retry = useCallback(() => {
		setAttempt((a) => a + 1);
	}, []);

	return { doc, changeDoc, handle, state, retry };
}

// React glue that keeps the offline-create queue draining: wires the live
// registerProject RPC, session/online gating, query invalidation, and the
// /p/$localId → /p/$serverId route remap into the reconcile controller, then
// triggers a drain on mount, on reconnect, on login, and on a periodic tick
// (so backoff-scheduled retries fire).

import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useOfflineSession } from "#/lib/auth/offline-session";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { registerProject } from "#/server/workspace.ts";
import type { ReconcileDeps } from "./reconcile-pending";
import { requestReconcile, setReconcileDeps } from "./reconcile-pending";

// How often to re-check the queue so backoff-scheduled retries fire even
// without an external event. Cheap: reconcileOnce early-returns when there's
// nothing eligible or no live session.
const TICK_MS = 15_000;

export function useReconciler(): void {
	const session = useOfflineSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const router = useRouter();
	const repo = useOptionalRepo();

	const live = session.source === "live";

	const deps = useMemo<ReconcileDeps>(
		() => ({
			register: (input) => registerProject({ data: input }),
			hasLiveSession: () =>
				live && (typeof navigator === "undefined" || navigator.onLine),
			onRegistered: (record, project) => {
				void queryClient.invalidateQueries({ queryKey: ["projects"] });
				// If the user is still sitting on the optimistic local route, swap
				// it for the canonical server id so downstream server calls
				// (comments, sharing) address the real row.
				const path = router.state.location.pathname;
				if (path === `/p/${record.localId}`) {
					void navigate({
						to: "/p/$projectId",
						params: { projectId: project.id },
						replace: true,
					});
				}
			},
			nudgeSync: (url) => {
				// Re-find the doc so the repo re-announces it to the now-authorized
				// sync server. Best-effort — failures are harmless.
				try {
					repo?.find(url as AutomergeUrl);
				} catch {
					// ignore
				}
			},
		}),
		[live, queryClient, navigate, router, repo],
	);

	useEffect(() => {
		setReconcileDeps(deps);
		void requestReconcile();
		const onOnline = () => void requestReconcile();
		const tick = setInterval(() => void requestReconcile(), TICK_MS);
		window.addEventListener("online", onOnline);
		return () => {
			window.removeEventListener("online", onOnline);
			clearInterval(tick);
			setReconcileDeps(null);
		};
	}, [deps]);

	// Drain immediately when a live session appears (e.g. just after login).
	useEffect(() => {
		if (live) void requestReconcile();
	}, [live]);
}

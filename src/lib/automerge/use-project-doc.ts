import type { AnyDocumentId, AutomergeUrl } from "@automerge/automerge-repo";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	findPendingByProjectId,
	hydratePending,
	isHydrated,
	usePendingProjects,
} from "#/lib/sync/pending-projects";
import { getProjectById } from "#/server/workspace.ts";
import type { PertProjectDoc } from "#/types/workspace";

export type { PertProjectDoc };

export type ProjectDocResolution =
	| { status: "loading" }
	| { status: "not-found" }
	| {
			status: "ready";
			documentId: AnyDocumentId;
			documentUrl: AutomergeUrl;
			title: string;
	  };

export function useProjectDoc(projectId: string): ProjectDocResolution {
	// Resolve offline-created projects from the local queue FIRST: their doc
	// lives only in the browser repo until the reconnect drain registers them,
	// so the server lookup would 404 (or fail entirely offline). Subscribing
	// here also re-renders when a localId is registered and gains a serverId.
	usePendingProjects();
	const local = findPendingByProjectId(projectId);

	// Kick off (idempotent) hydration so a hard reload offline finds the queued
	// record before we fall through to the server query.
	const [hydrated, setHydrated] = useState(isHydrated());
	useEffect(() => {
		if (!hydrated) hydratePending().then(() => setHydrated(true));
	}, [hydrated]);

	const query = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => getProjectById({ data: { projectId } }),
		staleTime: 60_000,
		retry: false,
		// Skip the server entirely for locally-resolved docs, and hold off until
		// the local queue has hydrated so we don't briefly flash "not found" for
		// an offline-created project on a cold reload.
		enabled: hydrated && !local,
	});

	if (local) {
		return {
			status: "ready",
			documentId: local.automergeDocUrl as unknown as AnyDocumentId,
			documentUrl: local.automergeDocUrl,
			title: local.title,
		};
	}
	// While the query is disabled (queue not yet hydrated) it reports `pending`
	// with an idle fetch — surfaced as "loading" so the canvas waits.
	if (query.isPending) return { status: "loading" };
	if (query.isError || !query.data) return { status: "not-found" };
	const url = query.data.automergeDocUrl;
	return {
		status: "ready",
		documentId: url as unknown as AnyDocumentId,
		documentUrl: url,
		title: query.data.title,
	};
}

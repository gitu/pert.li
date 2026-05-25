import type { AnyDocumentId, AutomergeUrl } from "@automerge/automerge-repo";
import { useQuery } from "@tanstack/react-query";
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
	const query = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => getProjectById({ data: { projectId } }),
		staleTime: 60_000,
		retry: false,
	});

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

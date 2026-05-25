import type { AnyDocumentId, AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { useQuery } from "@tanstack/react-query";
import { getOrCreateUserWorkspaceDoc } from "#/server/workspace.ts";
import type { WorkspaceDoc } from "#/types/workspace";

export type { WorkspaceDoc };

export function useUserWorkspaceDocUrl() {
	return useQuery({
		queryKey: ["user-workspace-doc-url"],
		queryFn: async () => {
			const { automergeDocUrl } = await getOrCreateUserWorkspaceDoc();
			return automergeDocUrl;
		},
		staleTime: Infinity,
		gcTime: Infinity,
	});
}

export function useUserWorkspaceDoc() {
	const { data: url, isPending } = useUserWorkspaceDocUrl();
	const [doc, changeDoc] = useDocument<WorkspaceDoc>(
		url as AnyDocumentId | undefined,
		{ suspense: false },
	);

	return {
		isPending: isPending || !doc,
		url: url as AutomergeUrl | undefined,
		doc,
		changeDoc,
	};
}

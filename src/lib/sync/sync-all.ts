// Manual "sync everything" controller. Walks every workspace the user belongs
// to → every project in it → re-announces each project's Automerge doc to the
// sync server via `find`. `repo.find()` while the /sync WebSocket is connected
// requests the server's copy and Automerge merges it into the local repo (CRDT,
// so the online version is pulled in without clobbering local edits). Pure and
// dependency-injected so it can be unit-tested without a real server or repo.

import type { AutomergeUrl } from "@automerge/automerge-repo";

export type SyncAllDeps = {
	// Lists the workspaces the user can access (fresh from the server, so newly
	// shared workspaces are discovered, not just whatever the query cache holds).
	listWorkspaces: () => Promise<Array<{ workspaceId: string }>>;
	// Lists the projects in a workspace.
	listProjects: (
		workspaceId: string,
	) => Promise<Array<{ automergeDocUrl: AutomergeUrl }>>;
	// Re-announces a doc to the sync server. Best-effort: the caller wraps
	// repo.find() so a single bad URL can't abort the whole sweep.
	find: (url: AutomergeUrl) => void;
};

export type SyncAllResult = {
	workspaces: number;
	projects: number;
};

// Re-announces every project doc across every accessible workspace. Dedups doc
// URLs (a project can surface via more than one membership) so each is found
// once. Returns counts for the result toast.
export async function syncAllProjects(
	deps: SyncAllDeps,
): Promise<SyncAllResult> {
	const workspaces = await deps.listWorkspaces();
	const seen = new Set<AutomergeUrl>();

	for (const { workspaceId } of workspaces) {
		const projects = await deps.listProjects(workspaceId);
		for (const { automergeDocUrl } of projects) {
			if (seen.has(automergeDocUrl)) continue;
			seen.add(automergeDocUrl);
			// Best-effort per doc — a single failure must not strand the rest.
			try {
				deps.find(automergeDocUrl);
			} catch {
				// ignore: nudging is fire-and-forget
			}
		}
	}

	return { workspaces: workspaces.length, projects: seen.size };
}

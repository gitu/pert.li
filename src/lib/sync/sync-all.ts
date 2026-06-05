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
	// Pulls a doc from the sync server. `repo.find()` is async: it resolves once
	// the doc is found locally or delivered from a peer, and rejects when the
	// doc is unavailable / times out. We await it so the result reflects what was
	// actually pulled, not merely scheduled — see syncAllProjects below.
	find: (url: AutomergeUrl) => Promise<unknown>;
};

export type SyncAllResult = {
	workspaces: number;
	// Unique project docs we attempted to pull.
	projects: number;
	// Docs whose find() resolved (found locally or delivered from the server).
	synced: number;
};

// Pulls every project doc across every accessible workspace from the sync
// server. Dedups doc URLs (a project can surface via more than one membership)
// so each is found once, then awaits all finds together. `Promise.allSettled`
// keeps it best-effort: a single unavailable / timed-out doc (a rejected
// promise) can't abort the rest, nor leak as an unhandled rejection. Returns
// counts for the result toast.
export async function syncAllProjects(
	deps: SyncAllDeps,
): Promise<SyncAllResult> {
	const workspaces = await deps.listWorkspaces();
	const urls = new Set<AutomergeUrl>();

	for (const { workspaceId } of workspaces) {
		const projects = await deps.listProjects(workspaceId);
		for (const { automergeDocUrl } of projects) urls.add(automergeDocUrl);
	}

	const results = await Promise.allSettled(
		[...urls].map((url) => deps.find(url)),
	);
	const synced = results.filter((r) => r.status === "fulfilled").length;

	return { workspaces: workspaces.length, projects: urls.size, synced };
}

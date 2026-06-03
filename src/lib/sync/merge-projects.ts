// Unions the server project list with the local offline-created queue so a
// project shows up in the workspace home / sidebar the instant it's created —
// before (and while) it registers server-side. Dedup is by Automerge doc URL:
// once a pending record registers and the server list refetches, the server
// row carries the same URL and the local copy drops out automatically.

import type { ProjectSummary } from "#/types/workspace";
import type { PendingProject } from "./pending-projects";
import { usePendingProjects } from "./pending-projects";

export function pendingToSummary(p: PendingProject): ProjectSummary {
	return {
		// Prefer the canonical server id once known so links/route params point at
		// the real row; fall back to the localId (a valid alias for useProjectDoc).
		id: p.serverId ?? p.localId,
		workspaceId: p.workspaceId ?? "",
		title: p.title,
		description: null,
		automergeDocUrl: p.automergeDocUrl,
		createdAt: p.createdAt,
		createdBy: "",
		parentProjectId: null,
		branchedFromHeads: null,
		branchedAt: null,
		archivedAt: null,
	};
}

export function mergeProjectLists(
	server: ProjectSummary[],
	pending: PendingProject[],
	activeWorkspaceId?: string,
): ProjectSummary[] {
	const serverUrls = new Set(server.map((p) => p.automergeDocUrl));
	const extras = pending
		.filter((p) => !serverUrls.has(p.automergeDocUrl))
		// Scope to the active workspace so an offline project created for one
		// workspace doesn't leak into another's list when the user switches.
		// Records with no explicit workspace (they'll land in the personal
		// workspace on register) stay visible everywhere so they're never
		// orphaned out of view.
		.filter(
			(p) =>
				p.workspaceId == null ||
				activeWorkspaceId == null ||
				p.workspaceId === activeWorkspaceId,
		)
		.map(pendingToSummary);
	// Local (newer, unsynced) entries first so a just-created project surfaces
	// at the top.
	return [...extras, ...server];
}

// React binding: merge a server list with the live local queue, scoped to the
// active workspace.
export function useMergedProjects(
	server: ProjectSummary[],
	activeWorkspaceId?: string,
): ProjectSummary[] {
	const pending = usePendingProjects();
	return mergeProjectLists(server, pending, activeWorkspaceId);
}

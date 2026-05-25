import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { PertDoc } from "#/lib/pert/types";

export type WorkspaceDoc = {
	schemaVersion: 1;
	pinnedProjects: AutomergeUrl[];
	lastOpenedProjectId: string | null;
	prefs: {
		theme?: "light" | "dark";
	};
};

export type PertProjectDoc = PertDoc;

export type ProjectSummary = {
	id: string;
	workspaceId: string;
	title: string;
	automergeDocUrl: AutomergeUrl;
	createdAt: string;
	createdBy: string;
};

export type WorkspaceRole = "owner" | "editor" | "viewer";

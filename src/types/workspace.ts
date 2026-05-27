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

// --- Workspace join links --------------------------------------------------
// Roles a join link is allowed to grant. Owners are excluded — promotion to
// owner stays a manual operation.
export type JoinLinkRole = Exclude<WorkspaceRole, "owner">;

export type WorkspaceInvitationSummary = {
	id: string;
	workspaceId: string;
	token: string;
	role: JoinLinkRole;
	createdBy: string;
	createdAt: string;
	expiresAt: string | null;
	maxUses: number | null;
	useCount: number;
	revokedAt: string | null;
};

export type WorkspaceInvitationPreview = {
	token: string;
	workspaceId: string;
	workspaceName: string;
	role: JoinLinkRole;
	expiresAt: string | null;
	maxUses: number | null;
	useCount: number;
	// Set when the link is unusable. Callers render a tailored error message.
	invalidReason: "revoked" | "expired" | "exhausted" | null;
};

export type WorkspaceMembershipSummary = {
	workspaceId: string;
	name: string;
	slug: string;
	role: WorkspaceRole;
	createdAt: string;
};

export type AcceptInvitationResult = {
	workspaceId: string;
	workspaceName: string;
	alreadyMember: boolean;
};

// --- Per-project share links ----------------------------------------------

export type ProjectShareMode = "view" | "edit";

export type ProjectShareSummary = {
	id: string;
	projectId: string;
	token: string;
	mode: ProjectShareMode;
	expiresAt: string | null;
	createdAt: string;
	createdBy: string;
};

export type ResolvedShare = {
	shareId: string;
	projectId: string;
	title: string;
	automergeDocUrl: AutomergeUrl;
	mode: ProjectShareMode;
	expiresAt: string | null;
};

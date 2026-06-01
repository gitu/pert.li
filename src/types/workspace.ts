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
	description: string | null;
	automergeDocUrl: AutomergeUrl;
	createdAt: string;
	createdBy: string;
	// Branch lineage. `parentProjectId` is null on root projects. When set,
	// `branchedFromHeads` carries the Automerge heads[] (parsed from JSON)
	// captured at fork time — used as the merge base for 3-way diffs.
	parentProjectId: string | null;
	branchedFromHeads: string[] | null;
	branchedAt: string | null;
	archivedAt: string | null;
};

export type ProjectComment = {
	id: string;
	projectId: string;
	authorId: string;
	authorName: string;
	body: string;
	createdAt: string;
	editedAt: string | null;
};

export type WorkspaceRole = "owner" | "editor" | "viewer";

// --- Workspace join links --------------------------------------------------
// Roles a join link is allowed to grant. Owners are excluded — promotion to
// owner stays a manual operation. "viewer" is excluded too, until the sync
// server can actually enforce read-only access (Automerge has no read-only
// peer mode today; admitting a viewer to sync silently grants full edit).
export type JoinLinkRole = "editor";

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

import { z } from "zod";
import { pertExchangeSchema } from "#/lib/pert/exchange";

export const createWorkspaceInput = z.object({
	name: z.string().trim().min(1, "Name is required").max(80),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const listProjectsInput = z.object({
	workspaceId: z.string().uuid().optional(),
});
export type ListProjectsInput = z.infer<typeof listProjectsInput>;

export const createProjectInput = z.object({
	title: z.string().trim().min(1, "Title is required").max(120),
	workspaceId: z.string().uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;

// Same validation as the .pert.json file the client uploads, re-checked
// server-side so a hand-crafted POST can't poison the Automerge doc.
export const importProjectInput = z.object({
	title: z.string().trim().min(1, "Title is required").max(120).optional(),
	workspaceId: z.string().uuid().optional(),
	exchange: pertExchangeSchema,
});

export type ImportProjectInput = z.infer<typeof importProjectInput>;

export const getProjectInput = z.object({
	projectId: z.string().uuid(),
});

export type GetProjectInput = z.infer<typeof getProjectInput>;

// --- Branch + project metadata --------------------------------------------
// Cap description length at the request layer; the DB column is unbounded but
// the dialog UI advertises a ~200-char limit and we don't want headlines.
export const forkProjectInput = z.object({
	parentProjectId: z.string().uuid(),
	title: z.string().trim().min(1, "Title is required").max(120),
	description: z.string().trim().max(500).nullable().optional(),
});
export type ForkProjectInput = z.infer<typeof forkProjectInput>;

export const updateProjectMetaInput = z.object({
	projectId: z.string().uuid(),
	title: z.string().trim().min(1).max(120).optional(),
	description: z.string().trim().max(500).nullable().optional(),
});
export type UpdateProjectMetaInput = z.infer<typeof updateProjectMetaInput>;

export const closeBranchInput = z.object({
	projectId: z.string().uuid(),
});
export type CloseBranchInput = z.infer<typeof closeBranchInput>;

// --- Project comments -----------------------------------------------------
export const listProjectCommentsInput = z.object({
	projectId: z.string().uuid(),
});
export type ListProjectCommentsInput = z.infer<typeof listProjectCommentsInput>;

export const addProjectCommentInput = z.object({
	projectId: z.string().uuid(),
	body: z.string().trim().min(1, "Comment body is required").max(4000),
});
export type AddProjectCommentInput = z.infer<typeof addProjectCommentInput>;

export const editProjectCommentInput = z.object({
	commentId: z.string().uuid(),
	body: z.string().trim().min(1, "Comment body is required").max(4000),
});
export type EditProjectCommentInput = z.infer<typeof editProjectCommentInput>;

export const deleteProjectCommentInput = z.object({
	commentId: z.string().uuid(),
});
export type DeleteProjectCommentInput = z.infer<
	typeof deleteProjectCommentInput
>;

// Only owner/editor are grantable through the API. The "viewer" enum value
// still exists in the DB for forward-compat with a future real read-only
// sync story, but Automerge has no read-only peer mode today, so admitting a
// viewer to the sync server would silently grant full edit (see
// userCanWriteDoc). Until that lands, viewer is unreachable via this path.
export const inviteMemberInput = z.object({
	workspaceId: z.string().uuid(),
	email: z.preprocess(
		(v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
		z.string().email(),
	),
	role: z.enum(["owner", "editor"]).default("editor"),
});

export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

// --- Workspace join links --------------------------------------------------
// Owner-only inputs for the join-link CRUD. `expiresAt` arrives as an ISO
// string (JSON-safe). `maxUses` is capped to keep abuse blast-radius bounded.
// "viewer" is intentionally NOT grantable here — see JoinLinkRole.
export const createJoinLinkInput = z.object({
	workspaceId: z.string().uuid(),
	role: z.enum(["editor"]).default("editor"),
	expiresAt: z.string().datetime().nullable().optional(),
	maxUses: z.number().int().positive().max(10_000).nullable().optional(),
});
export type CreateJoinLinkInput = z.infer<typeof createJoinLinkInput>;

export const listJoinLinksInput = z.object({
	workspaceId: z.string().uuid(),
});
export type ListJoinLinksInput = z.infer<typeof listJoinLinksInput>;

export const revokeJoinLinkInput = z.object({
	workspaceId: z.string().uuid(),
	invitationId: z.string().uuid(),
});
export type RevokeJoinLinkInput = z.infer<typeof revokeJoinLinkInput>;

// Tokens are base64url'd 24-byte randoms — 32 chars. Don't hard-code the
// length (future rotations may change it), but cap to a sensible upper bound
// to reject obviously malformed input fast.
export const joinTokenInput = z.object({
	token: z.string().min(16).max(128),
});
export type JoinTokenInput = z.infer<typeof joinTokenInput>;

// --- Per-project share links ----------------------------------------------

export const createShareInput = z.object({
	projectId: z.string().uuid(),
	mode: z.enum(["view", "edit"]),
	// ISO-8601 timestamp; `null` means "no expiry".
	expiresAt: z.string().datetime().nullable().optional(),
});

export type CreateShareInput = z.infer<typeof createShareInput>;

export const listSharesInput = z.object({
	projectId: z.string().uuid(),
});

export type ListSharesInput = z.infer<typeof listSharesInput>;

export const shareIdInput = z.object({
	shareId: z.string().uuid(),
});

export type ShareIdInput = z.infer<typeof shareIdInput>;

export const extendShareInput = z.object({
	shareId: z.string().uuid(),
	// `null` clears the expiry (link becomes permanent).
	expiresAt: z.string().datetime().nullable(),
});

export type ExtendShareInput = z.infer<typeof extendShareInput>;

export const resolveShareInput = z.object({
	// Tokens are 32-byte base64url strings — accept any 16-128 char string and
	// let the server lookup decide validity.
	token: z.string().min(16).max(128),
});

export type ResolveShareInput = z.infer<typeof resolveShareInput>;

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

// Owner-only inputs for the share-link CRUD. `expiresAt` arrives as an ISO
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

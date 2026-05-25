import { z } from "zod";

export const createProjectInput = z.object({
	title: z.string().trim().min(1, "Title is required").max(120),
	workspaceId: z.string().uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const getProjectInput = z.object({
	projectId: z.string().uuid(),
});

export type GetProjectInput = z.infer<typeof getProjectInput>;

export const inviteMemberInput = z.object({
	workspaceId: z.string().uuid(),
	email: z.preprocess(
		(v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
		z.string().email(),
	),
	role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

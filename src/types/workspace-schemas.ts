import { z } from "zod";
import { pertExchangeSchema } from "#/lib/pert/exchange";

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

export const inviteMemberInput = z.object({
	workspaceId: z.string().uuid(),
	email: z.preprocess(
		(v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
		z.string().email(),
	),
	role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

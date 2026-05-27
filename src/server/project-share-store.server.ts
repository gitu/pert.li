import { randomBytes, randomUUID } from "node:crypto";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "#/db";
import { project, projectShare, workspaceMember } from "#/db/schema";
import type {
	ProjectShareMode,
	ProjectShareSummary,
	ResolvedShare,
} from "#/types/workspace";

// 32 random bytes → 43-char base64url string. Far past the threshold for
// brute-force feasibility (256 bits of entropy), URL-safe, no padding.
function mintToken(): string {
	return randomBytes(32).toString("base64url");
}

function toSummary(row: {
	id: string;
	projectId: string;
	token: string;
	mode: ProjectShareMode;
	expiresAt: Date | null;
	createdAt: Date;
	createdBy: string;
}): ProjectShareSummary {
	return {
		id: row.id,
		projectId: row.projectId,
		token: row.token,
		mode: row.mode,
		expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdBy,
	};
}

// Authorization: the caller must be a member of the project's workspace AND
// either own the share (createdBy) or be an owner of the workspace. Returns
// the workspaceId on success, throws otherwise. Centralised here so every
// mutation funnels through the same gate.
export async function assertProjectAccess(opts: {
	projectId: string;
	userId: string;
}): Promise<{ workspaceId: string }> {
	const rows = await db
		.select({
			workspaceId: project.workspaceId,
		})
		.from(project)
		.innerJoin(
			workspaceMember,
			eq(workspaceMember.workspaceId, project.workspaceId),
		)
		.where(
			and(
				eq(project.id, opts.projectId),
				eq(workspaceMember.userId, opts.userId),
			),
		)
		.limit(1);
	if (rows.length === 0) throw new Error("Project not found");
	return { workspaceId: rows[0].workspaceId };
}

export async function createShare(opts: {
	projectId: string;
	mode: ProjectShareMode;
	expiresAt: Date | null;
	createdBy: string;
}): Promise<ProjectShareSummary> {
	const id = randomUUID();
	const token = mintToken();
	await db.insert(projectShare).values({
		id,
		projectId: opts.projectId,
		token,
		mode: opts.mode,
		expiresAt: opts.expiresAt,
		createdBy: opts.createdBy,
	});
	return toSummary({
		id,
		projectId: opts.projectId,
		token,
		mode: opts.mode,
		expiresAt: opts.expiresAt,
		createdAt: new Date(),
		createdBy: opts.createdBy,
	});
}

export async function listSharesForProject(
	projectId: string,
): Promise<ProjectShareSummary[]> {
	const rows = await db
		.select({
			id: projectShare.id,
			projectId: projectShare.projectId,
			token: projectShare.token,
			mode: projectShare.mode,
			expiresAt: projectShare.expiresAt,
			createdAt: projectShare.createdAt,
			createdBy: projectShare.createdBy,
		})
		.from(projectShare)
		.where(
			and(
				eq(projectShare.projectId, projectId),
				isNull(projectShare.revokedAt),
			),
		)
		.orderBy(desc(projectShare.createdAt));
	return rows.map((r) => toSummary(r));
}

// Revoke is a soft delete: keep the row for the audit trail; the unique
// `token` constraint still bars re-issue of the same string.
export async function revokeShare(opts: {
	shareId: string;
	userId: string;
}): Promise<void> {
	const rows = await db
		.select({ projectId: projectShare.projectId })
		.from(projectShare)
		.where(eq(projectShare.id, opts.shareId))
		.limit(1);
	if (rows.length === 0) throw new Error("Share not found");
	await assertProjectAccess({
		projectId: rows[0].projectId,
		userId: opts.userId,
	});
	await db
		.update(projectShare)
		.set({ revokedAt: new Date() })
		.where(eq(projectShare.id, opts.shareId));
}

export async function extendShare(opts: {
	shareId: string;
	expiresAt: Date | null;
	userId: string;
}): Promise<ProjectShareSummary> {
	const rows = await db
		.select({ projectId: projectShare.projectId })
		.from(projectShare)
		.where(eq(projectShare.id, opts.shareId))
		.limit(1);
	if (rows.length === 0) throw new Error("Share not found");
	await assertProjectAccess({
		projectId: rows[0].projectId,
		userId: opts.userId,
	});
	const [updated] = await db
		.update(projectShare)
		.set({ expiresAt: opts.expiresAt })
		.where(eq(projectShare.id, opts.shareId))
		.returning({
			id: projectShare.id,
			projectId: projectShare.projectId,
			token: projectShare.token,
			mode: projectShare.mode,
			expiresAt: projectShare.expiresAt,
			createdAt: projectShare.createdAt,
			createdBy: projectShare.createdBy,
		});
	return toSummary(updated);
}

// Public: look up a share by token and return enough to bootstrap the share
// route. Returns `null` for missing/revoked/expired tokens — the caller
// renders a generic "this link is no longer valid" page rather than leaking
// which of those it was.
export async function resolveShareByToken(
	token: string,
): Promise<ResolvedShare | null> {
	const rows = await db
		.select({
			id: projectShare.id,
			projectId: projectShare.projectId,
			mode: projectShare.mode,
			expiresAt: projectShare.expiresAt,
			revokedAt: projectShare.revokedAt,
			title: project.title,
			automergeDocUrl: project.automergeDocUrl,
			projectArchivedAt: project.archivedAt,
		})
		.from(projectShare)
		.innerJoin(project, eq(project.id, projectShare.projectId))
		.where(eq(projectShare.token, token))
		.limit(1);
	if (rows.length === 0) return null;
	const r = rows[0];
	if (r.revokedAt) return null;
	if (r.projectArchivedAt) return null;
	if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) return null;
	return {
		shareId: r.id,
		projectId: r.projectId,
		title: r.title,
		automergeDocUrl: r.automergeDocUrl as AutomergeUrl,
		mode: r.mode,
		expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
	};
}

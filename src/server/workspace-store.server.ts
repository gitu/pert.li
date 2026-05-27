import { randomBytes, randomUUID } from "node:crypto";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "#/db";
import {
	project,
	user,
	userWorkspaceDoc,
	workspace,
	workspaceInvitation,
	workspaceMember,
} from "#/db/schema";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import type {
	AcceptInvitationResult,
	JoinLinkRole,
	ProjectSummary,
	WorkspaceInvitationPreview,
	WorkspaceInvitationSummary,
	WorkspaceMembershipSummary,
	WorkspaceRole,
} from "#/types/workspace";
import { getServerRepo } from "./automerge-server.server.ts";

const slugFromBytes = () => randomBytes(6).toString("hex");

export async function ensurePersonalWorkspace(
	userId: string,
	name: string | null,
): Promise<string> {
	const existing = await db
		.select({ workspaceId: workspaceMember.workspaceId })
		.from(workspaceMember)
		.where(eq(workspaceMember.userId, userId));
	if (existing.length > 0) return existing[0].workspaceId;

	const workspaceId = randomUUID();
	const memberId = randomUUID();
	const slug = slugFromBytes();
	await db.insert(workspace).values({
		id: workspaceId,
		name: name ? `${name}'s workspace` : "Personal workspace",
		slug,
		createdBy: userId,
	});
	await db.insert(workspaceMember).values({
		id: memberId,
		workspaceId,
		userId,
		role: "owner",
	});
	return workspaceId;
}

export async function createWorkspaceForUser(opts: {
	userId: string;
	name: string;
}): Promise<{ workspaceId: string; name: string; slug: string }> {
	const workspaceId = randomUUID();
	const memberId = randomUUID();
	const slug = slugFromBytes();
	const name = opts.name.trim();
	if (!name) throw new Error("Workspace name is required");
	await db.insert(workspace).values({
		id: workspaceId,
		name,
		slug,
		createdBy: opts.userId,
	});
	await db.insert(workspaceMember).values({
		id: memberId,
		workspaceId,
		userId: opts.userId,
		role: "owner",
	});
	return { workspaceId, name, slug };
}

export async function listMembershipsForUser(
	userId: string,
): Promise<WorkspaceMembershipSummary[]> {
	const rows = await db
		.select({
			workspaceId: workspace.id,
			name: workspace.name,
			slug: workspace.slug,
			role: workspaceMember.role,
			createdAt: workspace.createdAt,
		})
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, userId))
		.orderBy(workspace.createdAt);
	return rows.map((r) => ({
		workspaceId: r.workspaceId,
		name: r.name,
		slug: r.slug,
		role: r.role as WorkspaceRole,
		createdAt: r.createdAt.toISOString(),
	}));
}

export async function getWorkspaceRole(
	userId: string,
	workspaceId: string,
): Promise<WorkspaceRole | null> {
	const rows = await db
		.select({ role: workspaceMember.role })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.userId, userId),
				eq(workspaceMember.workspaceId, workspaceId),
			),
		)
		.limit(1);
	return rows.length === 0 ? null : (rows[0].role as WorkspaceRole);
}

export async function listProjectsForWorkspace(
	workspaceId: string,
): Promise<ProjectSummary[]> {
	const rows = await db
		.select({
			id: project.id,
			workspaceId: project.workspaceId,
			title: project.title,
			automergeDocUrl: project.automergeDocUrl,
			createdAt: project.createdAt,
			createdBy: project.createdBy,
		})
		.from(project)
		.where(
			and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt)),
		)
		.orderBy(desc(project.createdAt));
	return rows.map((r) => ({
		id: r.id,
		workspaceId: r.workspaceId,
		title: r.title,
		automergeDocUrl: r.automergeDocUrl as AutomergeUrl,
		createdAt: r.createdAt.toISOString(),
		createdBy: r.createdBy,
	}));
}

export async function createProjectRow(opts: {
	workspaceId: string;
	title: string;
	createdBy: string;
	// Optional seed doc — used by the import flow to start a new project from
	// an uploaded .pert.json instead of an empty one. The title field on the
	// passed doc is overridden with `opts.title` so the DB row and the doc
	// title stay consistent.
	initialDoc?: PertDoc;
}): Promise<ProjectSummary> {
	const repo = getServerRepo();
	const seed = opts.initialDoc
		? { ...opts.initialDoc, title: opts.title }
		: createEmptyPertDoc(opts.title);
	const handle = repo.create(seed);
	const id = randomUUID();
	await db.insert(project).values({
		id,
		workspaceId: opts.workspaceId,
		title: opts.title,
		automergeDocUrl: handle.url,
		createdBy: opts.createdBy,
	});
	return {
		id,
		workspaceId: opts.workspaceId,
		title: opts.title,
		automergeDocUrl: handle.url as AutomergeUrl,
		createdAt: new Date().toISOString(),
		createdBy: opts.createdBy,
	};
}

export async function getProjectForUser(opts: {
	projectId: string;
	userId: string;
}): Promise<ProjectSummary | null> {
	const rows = await db
		.select({
			id: project.id,
			workspaceId: project.workspaceId,
			title: project.title,
			automergeDocUrl: project.automergeDocUrl,
			createdAt: project.createdAt,
			createdBy: project.createdBy,
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
	if (rows.length === 0) return null;
	const r = rows[0];
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		title: r.title,
		automergeDocUrl: r.automergeDocUrl as AutomergeUrl,
		createdAt: r.createdAt.toISOString(),
		createdBy: r.createdBy,
	};
}

export async function addMemberByEmail(opts: {
	workspaceId: string;
	email: string;
	role: WorkspaceRole;
}): Promise<{ alreadyMember: boolean }> {
	const invitee = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, opts.email))
		.limit(1);
	if (invitee.length === 0) {
		throw new Error(
			`No registered user with email ${opts.email}. Ask them to sign up first.`,
		);
	}

	const existing = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.workspaceId, opts.workspaceId),
				eq(workspaceMember.userId, invitee[0].id),
			),
		)
		.limit(1);
	if (existing.length > 0) return { alreadyMember: true };

	await db.insert(workspaceMember).values({
		id: randomUUID(),
		workspaceId: opts.workspaceId,
		userId: invitee[0].id,
		role: opts.role,
	});
	return { alreadyMember: false };
}

// 24 url-safe bytes ⇒ 32-char base64url — enough entropy that brute-force
// guessing across a single workspace's join links is infeasible without
// rate-limiting at the route layer.
function generateInvitationToken(): string {
	return randomBytes(24).toString("base64url");
}

function rowToSummary(row: {
	id: string;
	workspaceId: string;
	token: string;
	role: WorkspaceRole;
	createdBy: string;
	createdAt: Date;
	expiresAt: Date | null;
	maxUses: number | null;
	useCount: number;
	revokedAt: Date | null;
}): WorkspaceInvitationSummary {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		token: row.token,
		role: row.role as JoinLinkRole,
		createdBy: row.createdBy,
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt?.toISOString() ?? null,
		maxUses: row.maxUses,
		useCount: row.useCount,
		revokedAt: row.revokedAt?.toISOString() ?? null,
	};
}

export async function createWorkspaceInvitation(opts: {
	workspaceId: string;
	createdBy: string;
	role: JoinLinkRole;
	expiresAt?: Date | null;
	maxUses?: number | null;
}): Promise<WorkspaceInvitationSummary> {
	const id = randomUUID();
	const token = generateInvitationToken();
	const [row] = await db
		.insert(workspaceInvitation)
		.values({
			id,
			workspaceId: opts.workspaceId,
			token,
			role: opts.role,
			createdBy: opts.createdBy,
			expiresAt: opts.expiresAt ?? null,
			maxUses: opts.maxUses ?? null,
		})
		.returning();
	return rowToSummary(row);
}

export async function listWorkspaceInvitations(
	workspaceId: string,
): Promise<WorkspaceInvitationSummary[]> {
	const rows = await db
		.select()
		.from(workspaceInvitation)
		.where(eq(workspaceInvitation.workspaceId, workspaceId))
		.orderBy(desc(workspaceInvitation.createdAt));
	return rows.map(rowToSummary);
}

export async function revokeWorkspaceInvitation(opts: {
	invitationId: string;
	workspaceId: string;
}): Promise<{ revoked: boolean }> {
	const result = await db
		.update(workspaceInvitation)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(workspaceInvitation.id, opts.invitationId),
				eq(workspaceInvitation.workspaceId, opts.workspaceId),
				isNull(workspaceInvitation.revokedAt),
			),
		)
		.returning({ id: workspaceInvitation.id });
	return { revoked: result.length > 0 };
}

export async function getInvitationPreviewByToken(
	token: string,
): Promise<WorkspaceInvitationPreview | null> {
	const rows = await db
		.select({
			id: workspaceInvitation.id,
			workspaceId: workspaceInvitation.workspaceId,
			token: workspaceInvitation.token,
			role: workspaceInvitation.role,
			expiresAt: workspaceInvitation.expiresAt,
			maxUses: workspaceInvitation.maxUses,
			useCount: workspaceInvitation.useCount,
			revokedAt: workspaceInvitation.revokedAt,
			workspaceName: workspace.name,
		})
		.from(workspaceInvitation)
		.innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
		.where(eq(workspaceInvitation.token, token))
		.limit(1);
	if (rows.length === 0) return null;
	const r = rows[0];
	let invalidReason: WorkspaceInvitationPreview["invalidReason"] = null;
	if (r.revokedAt) invalidReason = "revoked";
	else if (r.expiresAt && r.expiresAt.getTime() <= Date.now())
		invalidReason = "expired";
	else if (r.maxUses != null && r.useCount >= r.maxUses)
		invalidReason = "exhausted";
	return {
		token: r.token,
		workspaceId: r.workspaceId,
		workspaceName: r.workspaceName,
		role: r.role as JoinLinkRole,
		expiresAt: r.expiresAt?.toISOString() ?? null,
		maxUses: r.maxUses,
		useCount: r.useCount,
		invalidReason,
	};
}

export async function acceptInvitationByToken(opts: {
	token: string;
	userId: string;
}): Promise<AcceptInvitationResult> {
	// Re-fetch inside the same logical flow to avoid TOCTOU between a
	// preview render and the accept click (e.g. owner revoked in between).
	const preview = await getInvitationPreviewByToken(opts.token);
	if (!preview) throw new Error("Invitation not found");
	if (preview.invalidReason === "revoked")
		throw new Error("This invitation has been revoked");
	if (preview.invalidReason === "expired")
		throw new Error("This invitation has expired");
	if (preview.invalidReason === "exhausted")
		throw new Error("This invitation has reached its usage limit");

	const existing = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.workspaceId, preview.workspaceId),
				eq(workspaceMember.userId, opts.userId),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		return {
			workspaceId: preview.workspaceId,
			workspaceName: preview.workspaceName,
			alreadyMember: true,
		};
	}

	await db.insert(workspaceMember).values({
		id: randomUUID(),
		workspaceId: preview.workspaceId,
		userId: opts.userId,
		role: preview.role,
	});
	// Increment use count after a real join (idempotent re-joins don't bump
	// the counter, so max-uses caps the number of *distinct* accepting users).
	await db
		.update(workspaceInvitation)
		.set({ useCount: preview.useCount + 1 })
		.where(eq(workspaceInvitation.token, opts.token));

	return {
		workspaceId: preview.workspaceId,
		workspaceName: preview.workspaceName,
		alreadyMember: false,
	};
}

export async function getOrCreatePersonalWorkspaceDocUrl(
	userId: string,
): Promise<AutomergeUrl> {
	const existing = await db
		.select({ url: userWorkspaceDoc.automergeDocUrl })
		.from(userWorkspaceDoc)
		.where(eq(userWorkspaceDoc.userId, userId))
		.limit(1);
	if (existing.length > 0) return existing[0].url as AutomergeUrl;

	const repo = getServerRepo();
	const handle = repo.create({
		schemaVersion: 1,
		pinnedProjects: [],
		lastOpenedProjectId: null,
		prefs: {},
	});
	await db.insert(userWorkspaceDoc).values({
		userId,
		automergeDocUrl: handle.url,
	});
	return handle.url as AutomergeUrl;
}

import { randomBytes, randomUUID } from "node:crypto";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "#/db";
import {
	project,
	user,
	userWorkspaceDoc,
	workspace,
	workspaceMember,
} from "#/db/schema";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import type { ProjectSummary, WorkspaceRole } from "#/types/workspace";
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

import { randomBytes, randomUUID } from "node:crypto";
import * as Automerge from "@automerge/automerge";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "#/db";
import {
	project,
	user,
	userWorkspaceDoc,
	workspace,
	workspaceInvitation,
	workspaceMember,
} from "#/db/schema";
import { changeWith } from "#/lib/pert/change-meta";
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

export type WritableWorkspaceRole = "owner" | "editor";

// Returns the user's role on the workspace only if it grants write access.
// "viewer" and non-membership both collapse to null. Used by every server fn
// that mutates workspace-scoped state, and by the Automerge sharePolicy —
// Automerge has no read-only peer mode, so admitting a viewer to sync would
// effectively grant them full edit. Until a real read-only sync story lands,
// viewers are gated out of both write paths and the sync server.
export async function getWritableWorkspaceRole(
	userId: string,
	workspaceId: string,
): Promise<WritableWorkspaceRole | null> {
	const role = await getWorkspaceRole(userId, workspaceId);
	return role === "owner" || role === "editor" ? role : null;
}

// Internal selector — keep DB column listing in one place so list/get/fork
// all return the same `ProjectSummary` shape without drift.
const projectColumns = {
	id: project.id,
	workspaceId: project.workspaceId,
	title: project.title,
	description: project.description,
	automergeDocUrl: project.automergeDocUrl,
	createdAt: project.createdAt,
	createdBy: project.createdBy,
	parentProjectId: project.parentProjectId,
	branchedFromHeads: project.branchedFromHeads,
	branchedAt: project.branchedAt,
	archivedAt: project.archivedAt,
} as const;

type ProjectRow = {
	id: string;
	workspaceId: string;
	title: string;
	description: string | null;
	automergeDocUrl: string;
	createdAt: Date;
	createdBy: string;
	parentProjectId: string | null;
	branchedFromHeads: string | null;
	branchedAt: Date | null;
	archivedAt: Date | null;
};

function projectRowToSummary(r: ProjectRow): ProjectSummary {
	let branchedFromHeads: string[] | null = null;
	if (r.branchedFromHeads) {
		try {
			const parsed = JSON.parse(r.branchedFromHeads);
			if (Array.isArray(parsed) && parsed.every((h) => typeof h === "string")) {
				branchedFromHeads = parsed;
			}
		} catch {
			// Stored value was malformed — surface as missing rather than crash.
		}
	}
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		title: r.title,
		description: r.description,
		automergeDocUrl: r.automergeDocUrl as AutomergeUrl,
		createdAt: r.createdAt.toISOString(),
		createdBy: r.createdBy,
		parentProjectId: r.parentProjectId,
		branchedFromHeads,
		branchedAt: r.branchedAt?.toISOString() ?? null,
		archivedAt: r.archivedAt?.toISOString() ?? null,
	};
}

export async function listProjectsForWorkspace(
	workspaceId: string,
	opts?: { includeArchived?: boolean },
): Promise<ProjectSummary[]> {
	const conditions = opts?.includeArchived
		? eq(project.workspaceId, workspaceId)
		: and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt));
	const rows = await db
		.select(projectColumns)
		.from(project)
		.where(conditions)
		.orderBy(desc(project.createdAt));
	return rows.map(projectRowToSummary);
}

export async function createProjectRow(opts: {
	workspaceId: string;
	title: string;
	createdBy: string;
	description?: string | null;
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
		description: opts.description?.trim() || null,
		automergeDocUrl: handle.url,
		createdBy: opts.createdBy,
	});
	const createdAt = new Date();
	return projectRowToSummary({
		id,
		workspaceId: opts.workspaceId,
		title: opts.title,
		description: opts.description?.trim() || null,
		automergeDocUrl: handle.url,
		createdAt,
		createdBy: opts.createdBy,
		parentProjectId: null,
		branchedFromHeads: null,
		branchedAt: null,
		archivedAt: null,
	});
}

// Register a client-created Automerge doc as a project row. The doc already
// lives in the browser repo (created offline / optimistically); here we only
// record the metadata pointing at it — we never call repo.create(). Recording
// the row first is what lets the sync server's sharePolicy authorize the owner
// to push the doc body (see automerge-server.server.ts).
//
// Idempotent on `automergeDocUrl`: a retry after a partial success (row
// written but the response was lost) returns the existing row instead of
// duplicating, and a second device that synced the same doc can't double-add.
export async function registerProjectRow(opts: {
	workspaceId: string;
	title: string;
	createdBy: string;
	automergeDocUrl: string;
	description?: string | null;
}): Promise<{ project: ProjectSummary; alreadyRegistered: boolean }> {
	const existing = await db
		.select(projectColumns)
		.from(project)
		.where(eq(project.automergeDocUrl, opts.automergeDocUrl))
		.limit(1);
	if (existing.length > 0) {
		const row = existing[0];
		// Doc URLs are 128-bit randoms, so a row matching this URL was created by
		// this user (or synced from their other device). Guard anyway: never hand
		// back a row the caller didn't create — treat it as an unrecoverable
		// conflict rather than leak another tenant's project.
		if (row.createdBy !== opts.createdBy) {
			throw new Error("This document is already registered to another account");
		}
		return { project: projectRowToSummary(row), alreadyRegistered: true };
	}
	const id = randomUUID();
	await db.insert(project).values({
		id,
		workspaceId: opts.workspaceId,
		title: opts.title,
		description: opts.description?.trim() || null,
		automergeDocUrl: opts.automergeDocUrl,
		createdBy: opts.createdBy,
	});
	const createdAt = new Date();
	return {
		project: projectRowToSummary({
			id,
			workspaceId: opts.workspaceId,
			title: opts.title,
			description: opts.description?.trim() || null,
			automergeDocUrl: opts.automergeDocUrl,
			createdAt,
			createdBy: opts.createdBy,
			parentProjectId: null,
			branchedFromHeads: null,
			branchedAt: null,
			archivedAt: null,
		}),
		alreadyRegistered: false,
	};
}

// Fork an existing project into a sibling "branch" project. Clones the
// parent's Automerge doc (preserving history + new actor id), captures heads
// at fork time as the merge base, and stamps system markers on both docs so
// the History drawer can show the fork point.
export async function forkProjectRow(opts: {
	parentProjectId: string;
	title: string;
	description?: string | null;
	createdBy: string;
}): Promise<ProjectSummary> {
	const parentRows = await db
		.select(projectColumns)
		.from(project)
		.where(eq(project.id, opts.parentProjectId))
		.limit(1);
	if (parentRows.length === 0) throw new Error("Parent project not found");
	const parent = parentRows[0];

	const repo = getServerRepo();
	const parentHandle = await repo.find<PertDoc>(
		parent.automergeDocUrl as AutomergeUrl,
	);
	// Make sure the parent's history is fully loaded before we clone — without
	// this the clone can capture a partial state (and the merge base heads we
	// snapshot below would diverge from what's actually on storage).
	await parentHandle.whenReady();
	const parentDoc = parentHandle.doc();
	const heads = Automerge.getHeads(parentDoc);

	const branchHandle = repo.clone<PertDoc>(parentHandle);
	await branchHandle.whenReady();
	const id = randomUUID();
	const title = opts.title.trim();
	if (!title) throw new Error("Branch title is required");
	const description = opts.description?.trim() || null;

	// System markers so the History drawer can show where the branch happened
	// on both sides. The branch gets a "branch-created" entry as the first
	// change after the clone; the parent gets a "branched-out" entry that
	// pins the fork point in its own timeline.
	branchHandle.change(
		(d) => {
			d.title = title;
		},
		{
			message: JSON.stringify({
				source: "system",
				kind: "branch-created",
				payload: {
					parentProjectId: opts.parentProjectId,
					parentTitle: parent.title,
					branchTitle: title,
					heads,
				},
			}),
			time: Math.floor(Date.now() / 1000),
		},
	);
	// Mutate something inside the callback — Automerge skips changes that
	// don't touch the doc, so a pure no-op callback wouldn't actually land
	// the "branched-out" history entry. We push the marker into a
	// `meta.branchedOut` log keyed by branch id so subsequent forks each
	// record their own entry without overwriting earlier ones.
	changeWith(
		parentHandle,
		"system",
		(d) => {
			if (!d.meta) d.meta = {};
			const meta = d.meta as Record<string, unknown>;
			let log = meta.branchedOut as
				| Record<string, { branchTitle: string; heads: string[]; at: number }>
				| undefined;
			if (!log) {
				log = {};
				meta.branchedOut = log;
			}
			log[id] = { branchTitle: title, heads, at: Date.now() };
		},
		{
			kind: "branched-out",
			payload: {
				branchTitle: title,
				heads,
			},
		},
	);

	await db.insert(project).values({
		id,
		workspaceId: parent.workspaceId,
		title,
		description,
		automergeDocUrl: branchHandle.url,
		createdBy: opts.createdBy,
		parentProjectId: opts.parentProjectId,
		branchedFromHeads: JSON.stringify(heads),
		branchedAt: new Date(),
	});

	// Flush both docs so the storage adapter persists the cloned doc + the
	// system markers before we return. Otherwise a client racing the response
	// can request the new URL via sync before any bytes hit the storage layer.
	await repo.flush();

	const branchedAt = new Date();
	return projectRowToSummary({
		id,
		workspaceId: parent.workspaceId,
		title,
		description,
		automergeDocUrl: branchHandle.url,
		createdAt: branchedAt,
		createdBy: opts.createdBy,
		parentProjectId: opts.parentProjectId,
		branchedFromHeads: JSON.stringify(heads),
		branchedAt,
		archivedAt: null,
	});
}

// Count existing branches of a parent project. Used by the branch dialog to
// suggest a non-colliding default name ("<parent> — branch 2").
export async function countBranchesOfProject(
	parentProjectId: string,
): Promise<number> {
	const rows = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.parentProjectId, parentProjectId),
				isNull(project.archivedAt),
			),
		);
	return rows.length;
}

// Update a project's title and/or description. Both fields are optional;
// undefined leaves them untouched. Trims and rejects empty title.
export async function updateProjectMeta(opts: {
	projectId: string;
	title?: string;
	description?: string | null;
}): Promise<void> {
	const patch: Record<string, unknown> = {};
	if (opts.title !== undefined) {
		const t = opts.title.trim();
		if (!t) throw new Error("Title cannot be empty");
		patch.title = t;
	}
	if (opts.description !== undefined) {
		patch.description = opts.description?.trim() || null;
	}
	if (Object.keys(patch).length === 0) return;
	await db.update(project).set(patch).where(eq(project.id, opts.projectId));

	// Keep the Automerge doc's `title` in sync with the DB row, so existing
	// in-doc title surfaces (download as JSON, etc.) don't drift after rename.
	if (typeof patch.title === "string") {
		const row = await db
			.select({ url: project.automergeDocUrl })
			.from(project)
			.where(eq(project.id, opts.projectId))
			.limit(1);
		if (row.length > 0) {
			const repo = getServerRepo();
			const handle = await repo.find<PertDoc>(row[0].url as AutomergeUrl);
			const title = patch.title;
			handle.change(
				(d) => {
					d.title = title;
				},
				{
					message: JSON.stringify({ source: "system", kind: "renamed" }),
					time: Math.floor(Date.now() / 1000),
				},
			);
		}
	}
}

// Archive a branch (typically after a successful merge). Sets archivedAt so
// the row drops out of the active project list but remains restorable.
export async function closeBranchProject(opts: {
	projectId: string;
}): Promise<void> {
	await db
		.update(project)
		.set({ archivedAt: new Date() })
		.where(eq(project.id, opts.projectId));
}

export async function getProjectForUser(opts: {
	projectId: string;
	userId: string;
}): Promise<ProjectSummary | null> {
	const rows = await db
		.select(projectColumns)
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
	return projectRowToSummary(rows[0]);
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

// Authorizes Automerge sync for a (user, doc) pair. Returns true iff the user
// is the owner of a personal workspace doc with this URL, OR is an
// owner/editor on a workspace whose project points at this URL. Viewers and
// non-members both collapse to false — see getWritableWorkspaceRole for why.
export async function userCanWriteDoc(
	userId: string,
	docUrl: string,
): Promise<boolean> {
	const owned = await db
		.select({ url: userWorkspaceDoc.automergeDocUrl })
		.from(userWorkspaceDoc)
		.where(
			and(
				eq(userWorkspaceDoc.userId, userId),
				eq(userWorkspaceDoc.automergeDocUrl, docUrl),
			),
		)
		.limit(1);
	if (owned.length > 0) return true;

	const projectAccess = await db
		.select({ role: workspaceMember.role })
		.from(project)
		.innerJoin(
			workspaceMember,
			eq(workspaceMember.workspaceId, project.workspaceId),
		)
		.where(
			and(
				eq(workspaceMember.userId, userId),
				eq(project.automergeDocUrl, docUrl),
			),
		)
		.limit(1);
	if (projectAccess.length === 0) return false;
	const role = projectAccess[0].role;
	return role === "owner" || role === "editor";
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
	// Look up the invitation + workspace name first. This is just for the
	// returned result and for the already-member fast path; the authoritative
	// validity check happens inside the conditional UPDATE below so we don't
	// race with concurrent accepts.
	const preview = await getInvitationPreviewByToken(opts.token);
	if (!preview) throw new Error("Invitation not found");

	// Defense-in-depth: even if a pre-existing DB row stamped role="viewer"
	// (no UI / API path creates one today — see createJoinLinkInput), refuse
	// to materialise that into a workspace_member row. Until real read-only
	// sync lands, viewer members are functionally broken anyway because the
	// sync server gates writes through userCanWriteDoc.
	if (preview.role !== "editor") {
		throw new Error(
			"This invitation grants an unsupported role and can't be redeemed.",
		);
	}

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

	// Atomically reserve a slot: bump use_count only if the invitation is
	// still revocable / not expired / under the max-uses cap. Two simultaneous
	// accepts can't both succeed past a max_uses=1 link because only one of
	// the UPDATEs will satisfy `use_count < max_uses`. We use the returning
	// rowcount as the gate for inserting membership.
	const claimed = await db
		.update(workspaceInvitation)
		.set({ useCount: sql`${workspaceInvitation.useCount} + 1` })
		.where(
			and(
				eq(workspaceInvitation.token, opts.token),
				isNull(workspaceInvitation.revokedAt),
				or(
					isNull(workspaceInvitation.expiresAt),
					gt(workspaceInvitation.expiresAt, new Date()),
				),
				or(
					isNull(workspaceInvitation.maxUses),
					sql`${workspaceInvitation.useCount} < ${workspaceInvitation.maxUses}`,
				),
			),
		)
		.returning({ id: workspaceInvitation.id });

	if (claimed.length === 0) {
		// Re-fetch to surface a precise reason (revoked / expired / exhausted)
		// for the error message — the conditional UPDATE collapsed all three.
		const fresh = await getInvitationPreviewByToken(opts.token);
		if (!fresh) throw new Error("Invitation not found");
		if (fresh.invalidReason === "revoked")
			throw new Error("This invitation has been revoked");
		if (fresh.invalidReason === "expired")
			throw new Error("This invitation has expired");
		if (fresh.invalidReason === "exhausted")
			throw new Error("This invitation has reached its usage limit");
		// Shouldn't happen: claim failed but the link reads as valid. Treat as
		// a transient race and surface a generic error.
		throw new Error("Could not accept invitation, please retry");
	}

	try {
		await db.insert(workspaceMember).values({
			id: randomUUID(),
			workspaceId: preview.workspaceId,
			userId: opts.userId,
			role: preview.role,
		});
	} catch (err) {
		// Roll back our reserved slot so the count keeps reflecting real joins
		// (e.g. a concurrent accept by the same user just won the unique index
		// race and the membership row already exists).
		await db
			.update(workspaceInvitation)
			.set({ useCount: sql`${workspaceInvitation.useCount} - 1` })
			.where(eq(workspaceInvitation.token, opts.token));
		throw err;
	}

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

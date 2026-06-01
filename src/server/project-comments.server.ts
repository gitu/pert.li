import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "#/db";
import { project, projectComment, user, workspaceMember } from "#/db/schema";
import type { ProjectComment } from "#/types/workspace";

// Workspace-membership gate. Mirrors getProjectForUser — comments are visible
// to anyone who can open the project, including viewers; only the author can
// edit/delete.
async function assertProjectAccess(opts: {
	projectId: string;
	userId: string;
}): Promise<void> {
	const rows = await db
		.select({ id: project.id })
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
}

export async function listProjectCommentsForUser(opts: {
	projectId: string;
	userId: string;
}): Promise<ProjectComment[]> {
	await assertProjectAccess(opts);
	const rows = await db
		.select({
			id: projectComment.id,
			projectId: projectComment.projectId,
			authorId: projectComment.authorId,
			authorName: user.name,
			body: projectComment.body,
			createdAt: projectComment.createdAt,
			editedAt: projectComment.editedAt,
		})
		.from(projectComment)
		.innerJoin(user, eq(user.id, projectComment.authorId))
		.where(eq(projectComment.projectId, opts.projectId))
		.orderBy(asc(projectComment.createdAt));
	return rows.map((r) => ({
		id: r.id,
		projectId: r.projectId,
		authorId: r.authorId,
		authorName: r.authorName,
		body: r.body,
		createdAt: r.createdAt.toISOString(),
		editedAt: r.editedAt?.toISOString() ?? null,
	}));
}

export async function addProjectComment(opts: {
	projectId: string;
	userId: string;
	body: string;
}): Promise<ProjectComment> {
	await assertProjectAccess({ projectId: opts.projectId, userId: opts.userId });
	const body = opts.body.trim();
	if (!body) throw new Error("Comment body is required");
	const id = randomUUID();
	await db.insert(projectComment).values({
		id,
		projectId: opts.projectId,
		authorId: opts.userId,
		body,
	});
	const [author] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, opts.userId))
		.limit(1);
	return {
		id,
		projectId: opts.projectId,
		authorId: opts.userId,
		authorName: author?.name ?? "Unknown",
		body,
		createdAt: new Date().toISOString(),
		editedAt: null,
	};
}

export async function editProjectComment(opts: {
	commentId: string;
	userId: string;
	body: string;
}): Promise<void> {
	const body = opts.body.trim();
	if (!body) throw new Error("Comment body is required");
	const result = await db
		.update(projectComment)
		.set({ body, editedAt: new Date() })
		.where(
			and(
				eq(projectComment.id, opts.commentId),
				eq(projectComment.authorId, opts.userId),
			),
		)
		.returning({ id: projectComment.id });
	if (result.length === 0)
		throw new Error("Comment not found or not yours to edit");
}

export async function deleteProjectComment(opts: {
	commentId: string;
	userId: string;
}): Promise<void> {
	const result = await db
		.delete(projectComment)
		.where(
			and(
				eq(projectComment.id, opts.commentId),
				eq(projectComment.authorId, opts.userId),
			),
		)
		.returning({ id: projectComment.id });
	if (result.length === 0)
		throw new Error("Comment not found or not yours to delete");
}

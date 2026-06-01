import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	project as projectTable,
	user as userTable,
	workspaceMember as workspaceMemberTable,
	workspace as workspaceTable,
} from "#/db/schema";
import { createTestDb, type TestDb } from "#/test/with-pglite";

let testDb: TestDb;
vi.mock("#/db", () => ({
	get db() {
		return testDb;
	},
}));

const {
	listProjectCommentsForUser,
	addProjectComment,
	editProjectComment,
	deleteProjectComment,
} = await import("#/server/project-comments.server");

async function seedUser(email: string, name: string): Promise<string> {
	const id = `usr_${randomUUID().slice(0, 8)}`;
	const now = new Date();
	await testDb.insert(userTable).values({
		id,
		email,
		name,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

async function seedWorkspaceAndProject(opts: {
	ownerId: string;
}): Promise<{ workspaceId: string; projectId: string }> {
	const workspaceId = randomUUID();
	await testDb.insert(workspaceTable).values({
		id: workspaceId,
		name: "ws",
		slug: randomUUID().slice(0, 8),
		createdBy: opts.ownerId,
	});
	await testDb.insert(workspaceMemberTable).values({
		id: randomUUID(),
		workspaceId,
		userId: opts.ownerId,
		role: "owner",
	});
	const projectId = randomUUID();
	await testDb.insert(projectTable).values({
		id: projectId,
		workspaceId,
		title: "p",
		automergeDocUrl: `automerge:${randomUUID()}`,
		createdBy: opts.ownerId,
	});
	return { workspaceId, projectId };
}

describe("project comments", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
	});
	afterEach(async () => {
		await ctx.close();
	});

	it("adds, lists, edits, and deletes comments end-to-end", async () => {
		const author = await seedUser("ada@example.com", "Ada");
		const { projectId } = await seedWorkspaceAndProject({ ownerId: author });

		const c1 = await addProjectComment({
			projectId,
			userId: author,
			body: "  first comment  ",
		});
		expect(c1.body).toBe("first comment");
		expect(c1.authorName).toBe("Ada");
		expect(c1.editedAt).toBeNull();

		await addProjectComment({
			projectId,
			userId: author,
			body: "second",
		});

		const listed = await listProjectCommentsForUser({
			projectId,
			userId: author,
		});
		expect(listed.map((c) => c.body)).toEqual(["first comment", "second"]);

		await editProjectComment({
			commentId: c1.id,
			userId: author,
			body: "first (edited)",
		});
		const afterEdit = await listProjectCommentsForUser({
			projectId,
			userId: author,
		});
		const edited = afterEdit.find((c) => c.id === c1.id);
		expect(edited?.body).toBe("first (edited)");
		expect(edited?.editedAt).not.toBeNull();

		await deleteProjectComment({ commentId: c1.id, userId: author });
		const afterDelete = await listProjectCommentsForUser({
			projectId,
			userId: author,
		});
		expect(afterDelete.map((c) => c.id)).not.toContain(c1.id);
	});

	it("rejects empty bodies", async () => {
		const author = await seedUser("ada@example.com", "Ada");
		const { projectId } = await seedWorkspaceAndProject({ ownerId: author });
		await expect(
			addProjectComment({ projectId, userId: author, body: "   " }),
		).rejects.toThrow(/required/i);
	});

	it("blocks non-members from listing or adding comments", async () => {
		const owner = await seedUser("ada@example.com", "Ada");
		const stranger = await seedUser("eve@example.com", "Eve");
		const { projectId } = await seedWorkspaceAndProject({ ownerId: owner });
		await expect(
			listProjectCommentsForUser({ projectId, userId: stranger }),
		).rejects.toThrow(/not found/i);
		await expect(
			addProjectComment({ projectId, userId: stranger, body: "hi" }),
		).rejects.toThrow(/not found/i);
	});

	it("blocks non-authors from editing or deleting another's comment", async () => {
		const owner = await seedUser("ada@example.com", "Ada");
		const peer = await seedUser("bob@example.com", "Bob");
		const { workspaceId, projectId } = await seedWorkspaceAndProject({
			ownerId: owner,
		});
		await testDb.insert(workspaceMemberTable).values({
			id: randomUUID(),
			workspaceId,
			userId: peer,
			role: "editor",
		});
		const c = await addProjectComment({
			projectId,
			userId: owner,
			body: "from owner",
		});
		await expect(
			editProjectComment({ commentId: c.id, userId: peer, body: "hijacked" }),
		).rejects.toThrow(/not yours/i);
		await expect(
			deleteProjectComment({ commentId: c.id, userId: peer }),
		).rejects.toThrow(/not yours/i);
	});
});

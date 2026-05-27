import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	project,
	user as userTable,
	workspace,
	workspaceMember,
} from "#/db/schema";
import { createTestDb, type TestDb } from "#/test/with-pglite";

let testDb: TestDb;
vi.mock("#/db", () => ({
	get db() {
		return testDb;
	},
}));

vi.mock("#/server/automerge-server.server", () => ({
	getServerRepo: () => {
		throw new Error("getServerRepo unused in these tests");
	},
}));

// Imported after the mocks so the SUT picks them up.
const {
	createShare,
	listSharesForProject,
	revokeShare,
	extendShare,
	resolveShareByToken,
	assertProjectAccess,
} = await import("#/server/project-share-store.server");

async function seedProject(opts?: { archived?: boolean }): Promise<{
	userId: string;
	workspaceId: string;
	projectId: string;
}> {
	const userId = `usr_${randomUUID()}`;
	const workspaceId = randomUUID();
	const projectId = randomUUID();
	const now = new Date();

	await testDb.insert(userTable).values({
		id: userId,
		email: `${userId}@example.com`,
		name: "Ada",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
	await testDb.insert(workspace).values({
		id: workspaceId,
		name: "ws",
		slug: workspaceId.slice(0, 8),
		createdBy: userId,
	});
	await testDb.insert(workspaceMember).values({
		id: randomUUID(),
		workspaceId,
		userId,
		role: "owner",
	});
	await testDb.insert(project).values({
		id: projectId,
		workspaceId,
		title: "Plan",
		automergeDocUrl: `automerge:doc-${projectId}`,
		createdBy: userId,
		archivedAt: opts?.archived ? new Date() : null,
	});

	return { userId, workspaceId, projectId };
}

describe("project-share-store (against PGLite)", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
	});
	afterEach(async () => {
		await ctx.close();
	});

	describe("createShare + listSharesForProject", () => {
		it("creates a share with a unique high-entropy token", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "edit",
				expiresAt: null,
				createdBy: userId,
			});
			expect(share.mode).toBe("edit");
			expect(share.expiresAt).toBeNull();
			// 32 bytes → 43-char base64url string
			expect(share.token).toMatch(/^[A-Za-z0-9_-]{40,48}$/);

			const list = await listSharesForProject(projectId);
			expect(list).toHaveLength(1);
			expect(list[0].id).toBe(share.id);
		});

		it("hides revoked shares from listShares", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: null,
				createdBy: userId,
			});
			await revokeShare({ shareId: share.id, userId });
			const list = await listSharesForProject(projectId);
			expect(list).toHaveLength(0);
		});
	});

	describe("resolveShareByToken", () => {
		it("returns the project info for a live token", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: null,
				createdBy: userId,
			});
			const resolved = await resolveShareByToken(share.token);
			expect(resolved).not.toBeNull();
			expect(resolved?.projectId).toBe(projectId);
			expect(resolved?.title).toBe("Plan");
			expect(resolved?.mode).toBe("view");
		});

		it("returns null for a revoked token", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "edit",
				expiresAt: null,
				createdBy: userId,
			});
			await revokeShare({ shareId: share.id, userId });
			expect(await resolveShareByToken(share.token)).toBeNull();
		});

		it("returns null for an expired token", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: new Date(Date.now() - 60_000),
				createdBy: userId,
			});
			expect(await resolveShareByToken(share.token)).toBeNull();
		});

		it("returns null for an archived project", async () => {
			const { userId, projectId } = await seedProject({ archived: true });
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: null,
				createdBy: userId,
			});
			expect(await resolveShareByToken(share.token)).toBeNull();
		});

		it("returns null for a token that doesn't exist", async () => {
			expect(await resolveShareByToken("nope-no-such-token-string")).toBeNull();
		});
	});

	describe("extendShare", () => {
		it("bumps the expiry forward", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: new Date(Date.now() + 60_000),
				createdBy: userId,
			});
			const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
			const updated = await extendShare({
				shareId: share.id,
				expiresAt: future,
				userId,
			});
			expect(updated.expiresAt).toBe(future.toISOString());
		});

		it("clears the expiry when given null", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: new Date(Date.now() + 60_000),
				createdBy: userId,
			});
			const updated = await extendShare({
				shareId: share.id,
				expiresAt: null,
				userId,
			});
			expect(updated.expiresAt).toBeNull();
		});
	});

	describe("assertProjectAccess", () => {
		it("rejects a user who isn't a member of the project's workspace", async () => {
			const { projectId } = await seedProject();
			const outsider = `usr_${randomUUID()}`;
			const now = new Date();
			await testDb.insert(userTable).values({
				id: outsider,
				email: "out@example.com",
				name: "Out",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await expect(
				assertProjectAccess({ projectId, userId: outsider }),
			).rejects.toThrow(/Project not found/);
		});

		it("rejects revoke from a non-member", async () => {
			const { userId, projectId } = await seedProject();
			const share = await createShare({
				projectId,
				mode: "view",
				expiresAt: null,
				createdBy: userId,
			});
			const outsider = `usr_${randomUUID()}`;
			const now = new Date();
			await testDb.insert(userTable).values({
				id: outsider,
				email: "out@example.com",
				name: "Out",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await expect(
				revokeShare({ shareId: share.id, userId: outsider }),
			).rejects.toThrow(/Project not found/);
		});
	});
});

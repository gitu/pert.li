import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	project as projectTable,
	user as userTable,
	userWorkspaceDoc as userWorkspaceDocTable,
	workspaceMember as workspaceMemberTable,
} from "#/db/schema";
import { createTestDb, type TestDb } from "#/test/with-pglite";

// Inject a per-test PGLite DB into the singleton db proxy at #/db. The
// getter form ensures every read of `db` returns whatever `testDb` points
// to right now — so the workspace store sees a fresh DB each test.
let testDb: TestDb;
vi.mock("#/db", () => ({
	get db() {
		return testDb;
	},
}));

// getServerRepo isn't needed for the queries we test here, but it's
// imported transitively by workspace-store.server.ts and pulls in the WS
// adapter. Stub it so the module loads without spinning a sync server.
vi.mock("#/server/automerge-server.server", () => ({
	getServerRepo: () => {
		throw new Error("getServerRepo unused in these tests");
	},
}));

// Import AFTER the mocks so the SUT picks them up.
const {
	ensurePersonalWorkspace,
	getWorkspaceRole,
	getWritableWorkspaceRole,
	addMemberByEmail,
	listProjectsForWorkspace,
	userCanWriteDoc,
} = await import("#/server/workspace-store.server");

async function seedUser(
	email = "ada@example.com",
	name = "Ada",
): Promise<string> {
	const id = `usr_${Math.random().toString(36).slice(2, 10)}`;
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

describe("workspace store (against PGLite)", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
	});

	afterEach(async () => {
		await ctx.close();
	});

	describe("ensurePersonalWorkspace", () => {
		it("creates a fresh workspace + owner membership on first call", async () => {
			const userId = await seedUser();
			const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
			expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);

			const role = await getWorkspaceRole(userId, workspaceId);
			expect(role).toBe("owner");

			const projects = await listProjectsForWorkspace(workspaceId);
			expect(projects).toEqual([]);
		});

		it("is idempotent — returns the same workspace id on repeat calls", async () => {
			const userId = await seedUser();
			const first = await ensurePersonalWorkspace(userId, "Ada");
			const second = await ensurePersonalWorkspace(userId, "Ada");
			expect(second).toBe(first);
		});

		it("falls back to a generic name when the user has no display name", async () => {
			const userId = await seedUser("ada@example.com", "");
			await ensurePersonalWorkspace(userId, null);
			// Spot-check via the role lookup — confirms the workspace + member
			// rows landed without depending on the workspace's name being
			// observable through the public surface.
			const workspaceId = await ensurePersonalWorkspace(userId, null);
			expect(await getWorkspaceRole(userId, workspaceId)).toBe("owner");
		});
	});

	describe("getWorkspaceRole", () => {
		it("returns null for a user who isn't a member", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const outsiderId = await seedUser("rando@example.com", "Outsider");
			expect(await getWorkspaceRole(outsiderId, workspaceId)).toBeNull();
		});
	});

	describe("addMemberByEmail", () => {
		it("adds a registered user as a member", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const inviteeId = await seedUser("invitee@example.com", "Invitee");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const result = await addMemberByEmail({
				workspaceId,
				email: "invitee@example.com",
				role: "editor",
			});
			expect(result).toEqual({ alreadyMember: false });
			expect(await getWorkspaceRole(inviteeId, workspaceId)).toBe("editor");
		});

		it("is idempotent for an existing member", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			await seedUser("invitee@example.com", "Invitee");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			await addMemberByEmail({
				workspaceId,
				email: "invitee@example.com",
				role: "editor",
			});
			const second = await addMemberByEmail({
				workspaceId,
				email: "invitee@example.com",
				role: "editor",
			});
			expect(second).toEqual({ alreadyMember: true });
		});

		it("rejects an email that isn't a registered user", async () => {
			const ownerId = await seedUser();
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Ada");
			await expect(
				addMemberByEmail({
					workspaceId,
					email: "ghost@example.com",
					role: "editor",
				}),
			).rejects.toThrow(/No registered user/);
		});
	});

	describe("getWritableWorkspaceRole", () => {
		it("returns the role for an owner or editor", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const editorId = await seedUser("editor@example.com", "Editor");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			await addMemberByEmail({
				workspaceId,
				email: "editor@example.com",
				role: "editor",
			});
			expect(await getWritableWorkspaceRole(ownerId, workspaceId)).toBe(
				"owner",
			);
			expect(await getWritableWorkspaceRole(editorId, workspaceId)).toBe(
				"editor",
			);
		});

		it("returns null for a viewer (no write access)", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const viewerId = await seedUser("viewer@example.com", "Viewer");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			// Insert a viewer row directly — the inviteMemberInput schema no
			// longer surfaces "viewer", but pre-existing DB rows are exactly
			// the case this check needs to keep covering.
			await testDb.insert(workspaceMemberTable).values({
				id: `mem_${Math.random().toString(36).slice(2, 10)}`,
				workspaceId,
				userId: viewerId,
				role: "viewer",
			});
			expect(await getWorkspaceRole(viewerId, workspaceId)).toBe("viewer");
			expect(await getWritableWorkspaceRole(viewerId, workspaceId)).toBeNull();
		});

		it("returns null for a non-member", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const outsiderId = await seedUser("rando@example.com", "Outsider");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			expect(
				await getWritableWorkspaceRole(outsiderId, workspaceId),
			).toBeNull();
		});
	});

	describe("userCanWriteDoc", () => {
		// Seed a workspace + project, return the doc URL plus member ids for
		// the cases below.
		async function seedWorkspaceWithProject(memberRoles: {
			ownerEmail: string;
			editorEmail?: string;
			viewerEmail?: string;
		}) {
			const ownerId = await seedUser(memberRoles.ownerEmail, "Owner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const docUrl = `automerge:${Math.random().toString(36).slice(2, 14)}`;
			await testDb.insert(projectTable).values({
				id: `prj_${Math.random().toString(36).slice(2, 10)}`,
				workspaceId,
				title: "Test",
				automergeDocUrl: docUrl,
				createdBy: ownerId,
			});
			let editorId: string | undefined;
			if (memberRoles.editorEmail) {
				editorId = await seedUser(memberRoles.editorEmail, "Editor");
				await addMemberByEmail({
					workspaceId,
					email: memberRoles.editorEmail,
					role: "editor",
				});
			}
			let viewerId: string | undefined;
			if (memberRoles.viewerEmail) {
				viewerId = await seedUser(memberRoles.viewerEmail, "Viewer");
				await testDb.insert(workspaceMemberTable).values({
					id: `mem_${Math.random().toString(36).slice(2, 10)}`,
					workspaceId,
					userId: viewerId,
					role: "viewer",
				});
			}
			return { ownerId, editorId, viewerId, workspaceId, docUrl };
		}

		it("allows owner and editor on a workspace project", async () => {
			const { ownerId, editorId, docUrl } = await seedWorkspaceWithProject({
				ownerEmail: "o@e.com",
				editorEmail: "e@e.com",
			});
			if (!editorId) throw new Error("test setup: editor not seeded");
			expect(await userCanWriteDoc(ownerId, docUrl)).toBe(true);
			expect(await userCanWriteDoc(editorId, docUrl)).toBe(true);
		});

		it("blocks a viewer on a workspace project", async () => {
			const { viewerId, docUrl } = await seedWorkspaceWithProject({
				ownerEmail: "o@e.com",
				viewerEmail: "v@e.com",
			});
			if (!viewerId) throw new Error("test setup: viewer not seeded");
			expect(await userCanWriteDoc(viewerId, docUrl)).toBe(false);
		});

		it("blocks a non-member", async () => {
			const { docUrl } = await seedWorkspaceWithProject({
				ownerEmail: "o@e.com",
			});
			const outsiderId = await seedUser("rando@example.com", "Outsider");
			expect(await userCanWriteDoc(outsiderId, docUrl)).toBe(false);
		});

		it("blocks access to an unrelated doc URL", async () => {
			const { ownerId } = await seedWorkspaceWithProject({
				ownerEmail: "o@e.com",
			});
			expect(await userCanWriteDoc(ownerId, "automerge:other-doc")).toBe(false);
		});

		it("allows the personal workspace-doc owner without a role check", async () => {
			const userId = await seedUser("solo@example.com", "Solo");
			const docUrl = `automerge:${Math.random().toString(36).slice(2, 14)}`;
			await testDb.insert(userWorkspaceDocTable).values({
				userId,
				automergeDocUrl: docUrl,
			});
			expect(await userCanWriteDoc(userId, docUrl)).toBe(true);
		});

		it("doesn't leak another user's personal workspace doc", async () => {
			const aliceId = await seedUser("alice@example.com", "Alice");
			const bobId = await seedUser("bob@example.com", "Bob");
			const docUrl = `automerge:${Math.random().toString(36).slice(2, 14)}`;
			await testDb.insert(userWorkspaceDocTable).values({
				userId: aliceId,
				automergeDocUrl: docUrl,
			});
			expect(await userCanWriteDoc(bobId, docUrl)).toBe(false);
		});
	});
});

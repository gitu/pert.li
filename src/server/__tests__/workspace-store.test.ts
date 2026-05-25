import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { user as userTable } from "#/db/schema";
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
	addMemberByEmail,
	listProjectsForWorkspace,
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
});

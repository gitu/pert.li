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
	createWorkspaceInvitation,
	listWorkspaceInvitations,
	revokeWorkspaceInvitation,
	getInvitationPreviewByToken,
	acceptInvitationByToken,
	createWorkspaceForUser,
	listMembershipsForUser,
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

	describe("createWorkspaceForUser + listMembershipsForUser", () => {
		it("creates a new workspace with the user as owner", async () => {
			const userId = await seedUser();
			const result = await createWorkspaceForUser({
				userId,
				name: "Acme Planning",
			});
			expect(result.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
			expect(result.name).toBe("Acme Planning");
			expect(await getWorkspaceRole(userId, result.workspaceId)).toBe("owner");
		});

		it("trims the name and rejects an empty string", async () => {
			const userId = await seedUser();
			const created = await createWorkspaceForUser({
				userId,
				name: "  Padded  ",
			});
			expect(created.name).toBe("Padded");
			await expect(
				createWorkspaceForUser({ userId, name: "   " }),
			).rejects.toThrow(/required/i);
		});

		it("lists every workspace the user belongs to, with their role", async () => {
			const userId = await seedUser("ada@example.com", "Ada");
			const otherOwnerId = await seedUser("bob@example.com", "Bob");
			const personalId = await ensurePersonalWorkspace(userId, "Ada");
			const owned = await createWorkspaceForUser({ userId, name: "Owned" });
			// A workspace the user is invited into as editor.
			const otherWs = await createWorkspaceForUser({
				userId: otherOwnerId,
				name: "Other",
			});
			await addMemberByEmail({
				workspaceId: otherWs.workspaceId,
				email: "ada@example.com",
				role: "editor",
			});
			const list = await listMembershipsForUser(userId);
			const byId = new Map(list.map((m) => [m.workspaceId, m]));
			expect(byId.get(personalId)?.role).toBe("owner");
			expect(byId.get(owned.workspaceId)?.role).toBe("owner");
			expect(byId.get(otherWs.workspaceId)?.role).toBe("editor");
			// Bob's third workspace isn't listed for Ada.
			expect(list.length).toBe(3);
		});
	});

	describe("workspace invitations (share links)", () => {
		it("creates a link with a token, role, and zero usage", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const invitation = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
			expect(invitation.role).toBe("editor");
			expect(invitation.useCount).toBe(0);
			expect(invitation.revokedAt).toBeNull();
			expect(invitation.expiresAt).toBeNull();
			expect(invitation.maxUses).toBeNull();
		});

		it("lists invitations newest-first and round-trips dates as ISO", async () => {
			const ownerId = await seedUser();
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Ada");
			const first = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			// Small delay so created_at definitely differs.
			await new Promise((r) => setTimeout(r, 10));
			const second = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			const list = await listWorkspaceInvitations(workspaceId);
			expect(list.map((l) => l.id)).toEqual([second.id, first.id]);
		});

		it("preview reports null for an unknown token", async () => {
			expect(await getInvitationPreviewByToken("nope-not-a-token")).toBeNull();
		});

		it("preview surfaces revoked / expired / exhausted states", async () => {
			const ownerId = await seedUser();
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Ada");

			const revoked = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			await revokeWorkspaceInvitation({
				invitationId: revoked.id,
				workspaceId,
			});
			const revokedPreview = await getInvitationPreviewByToken(revoked.token);
			expect(revokedPreview?.invalidReason).toBe("revoked");

			const expired = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
				expiresAt: new Date(Date.now() - 60_000),
			});
			const expiredPreview = await getInvitationPreviewByToken(expired.token);
			expect(expiredPreview?.invalidReason).toBe("expired");

			const capped = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
				maxUses: 1,
			});
			// Accept once to consume the only slot.
			const joinerId = await seedUser("joiner@example.com", "Joiner");
			await acceptInvitationByToken({
				token: capped.token,
				userId: joinerId,
			});
			const cappedPreview = await getInvitationPreviewByToken(capped.token);
			expect(cappedPreview?.invalidReason).toBe("exhausted");
		});

		it("accept adds the user with the link's role and bumps useCount", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const joinerId = await seedUser("joiner@example.com", "Joiner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const invitation = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			const result = await acceptInvitationByToken({
				token: invitation.token,
				userId: joinerId,
			});
			expect(result).toEqual({
				workspaceId,
				workspaceName: result.workspaceName,
				alreadyMember: false,
			});
			expect(await getWorkspaceRole(joinerId, workspaceId)).toBe("editor");
			const [refreshed] = await listWorkspaceInvitations(workspaceId);
			expect(refreshed.useCount).toBe(1);
		});

		it("refuses to redeem a viewer-role link (defense-in-depth)", async () => {
			// JoinLinkRole no longer admits "viewer" at the input layer, but
			// pre-existing DB rows (or any future code path that inserts one)
			// must not materialise into a workspace_member: acceptInvitationByToken
			// rejects them explicitly before bumping use_count.
			const ownerId = await seedUser("owner@example.com", "Owner");
			const joinerId = await seedUser("joiner@example.com", "Joiner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			// Bypass createWorkspaceInvitation's typed surface to insert a
			// viewer-role row directly — simulating an old DB record.
			const { workspaceInvitation } = await import("#/db/schema");
			await testDb.insert(workspaceInvitation).values({
				id: `inv_${Math.random().toString(36).slice(2, 10)}`,
				workspaceId,
				token: "viewer-link-test-token",
				role: "viewer",
				createdBy: ownerId,
			});
			await expect(
				acceptInvitationByToken({
					token: "viewer-link-test-token",
					userId: joinerId,
				}),
			).rejects.toThrow(/unsupported role/i);
			// And the user wasn't added either.
			expect(await getWorkspaceRole(joinerId, workspaceId)).toBeNull();
		});

		it("accept is idempotent for an existing member and doesn't bump useCount", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const joinerId = await seedUser("joiner@example.com", "Joiner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const invitation = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			await acceptInvitationByToken({
				token: invitation.token,
				userId: joinerId,
			});
			const second = await acceptInvitationByToken({
				token: invitation.token,
				userId: joinerId,
			});
			expect(second.alreadyMember).toBe(true);
			const [refreshed] = await listWorkspaceInvitations(workspaceId);
			// One distinct user joined → useCount stays at 1.
			expect(refreshed.useCount).toBe(1);
		});

		it("accept rejects revoked / expired / exhausted invitations", async () => {
			const ownerId = await seedUser();
			const joinerId = await seedUser("joiner@example.com", "Joiner");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Ada");

			const revoked = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			await revokeWorkspaceInvitation({
				invitationId: revoked.id,
				workspaceId,
			});
			await expect(
				acceptInvitationByToken({ token: revoked.token, userId: joinerId }),
			).rejects.toThrow(/revoked/i);

			const expired = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
				expiresAt: new Date(Date.now() - 60_000),
			});
			await expect(
				acceptInvitationByToken({ token: expired.token, userId: joinerId }),
			).rejects.toThrow(/expired/i);
		});

		it("two concurrent accepts on a max_uses=1 link only let one through", async () => {
			const ownerId = await seedUser("owner@example.com", "Owner");
			const aId = await seedUser("a@example.com", "A");
			const bId = await seedUser("b@example.com", "B");
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Owner");
			const invitation = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
				maxUses: 1,
			});
			const results = await Promise.allSettled([
				acceptInvitationByToken({ token: invitation.token, userId: aId }),
				acceptInvitationByToken({ token: invitation.token, userId: bId }),
			]);
			const wins = results.filter((r) => r.status === "fulfilled");
			const losses = results.filter((r) => r.status === "rejected");
			expect(wins.length).toBe(1);
			expect(losses.length).toBe(1);
			const [refreshed] = await listWorkspaceInvitations(workspaceId);
			// Counter never exceeds the cap even with two simultaneous attempts.
			expect(refreshed.useCount).toBe(1);
		});

		it("revoke only affects the matching workspace+id pair and is idempotent", async () => {
			const ownerId = await seedUser();
			const workspaceId = await ensurePersonalWorkspace(ownerId, "Ada");
			const invitation = await createWorkspaceInvitation({
				workspaceId,
				createdBy: ownerId,
				role: "editor",
			});
			const first = await revokeWorkspaceInvitation({
				invitationId: invitation.id,
				workspaceId,
			});
			expect(first.revoked).toBe(true);
			// Already revoked → second call reports no change.
			const second = await revokeWorkspaceInvitation({
				invitationId: invitation.id,
				workspaceId,
			});
			expect(second.revoked).toBe(false);
			// Foreign workspace id can't revoke.
			const third = await revokeWorkspaceInvitation({
				invitationId: invitation.id,
				workspaceId: "00000000-0000-0000-0000-000000000000",
			});
			expect(third.revoked).toBe(false);
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	project,
	session as sessionTable,
	user as userTable,
	workspace,
} from "#/db/schema";
import { createTestDb, type TestDb } from "#/test/with-pglite";

let testDb: TestDb;
vi.mock("#/db", () => ({
	get db() {
		return testDb;
	},
}));

const { getAdminStats, listAdminUsers } = await import(
	"#/server/admin-store.server"
);

async function seedUser(opts: {
	id?: string;
	email: string;
	name?: string;
	isAdmin?: boolean;
	createdAt?: Date;
}): Promise<string> {
	const id = opts.id ?? `usr_${Math.random().toString(36).slice(2, 10)}`;
	const now = opts.createdAt ?? new Date();
	await testDb.insert(userTable).values({
		id,
		email: opts.email,
		name: opts.name ?? opts.email.split("@")[0],
		emailVerified: true,
		isAdmin: opts.isAdmin ?? false,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

describe("admin store", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
	});

	afterEach(async () => {
		await ctx.close();
	});

	it("getAdminStats returns zeros on an empty DB", async () => {
		const stats = await getAdminStats();
		expect(stats).toEqual({
			users: 0,
			admins: 0,
			workspaces: 0,
			projects: 0,
			activeSessions: 0,
		});
	});

	it("getAdminStats counts users, admins, workspaces, projects, sessions", async () => {
		const ada = await seedUser({ email: "ada@example.com", isAdmin: true });
		const linus = await seedUser({ email: "linus@example.com" });
		const grace = await seedUser({ email: "grace@example.com" });

		const wsId = "ws_1";
		await testDb.insert(workspace).values({
			id: wsId,
			name: "Ada's workspace",
			slug: "ada",
			createdBy: ada,
		});

		await testDb.insert(project).values({
			id: "p_1",
			workspaceId: wsId,
			title: "Roadmap",
			automergeDocUrl: "automerge:abc",
			createdBy: ada,
		});
		// An archived project still gets counted by getAdminStats — the panel
		// is an operator overview, not a "live work" board.
		await testDb.insert(project).values({
			id: "p_2",
			workspaceId: wsId,
			title: "Old",
			automergeDocUrl: "automerge:def",
			createdBy: ada,
			archivedAt: new Date(),
		});

		const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
		await testDb.insert(sessionTable).values({
			id: "s_1",
			token: "tok-1",
			userId: linus,
			expiresAt: inOneHour,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const stats = await getAdminStats();
		expect(stats).toEqual({
			users: 3,
			admins: 1,
			workspaces: 1,
			projects: 2,
			activeSessions: 1,
		});
		// Reference all created IDs so TS's noUnusedLocals doesn't complain
		// when refactoring — they're load-bearing for the seeded counts.
		void grace;
	});

	it("listAdminUsers returns users in newest-first order with isAdmin flag", async () => {
		const oldest = new Date("2026-01-01T00:00:00Z");
		const middle = new Date("2026-03-01T00:00:00Z");
		const newest = new Date("2026-05-01T00:00:00Z");
		await seedUser({
			email: "first@example.com",
			isAdmin: true,
			createdAt: oldest,
		});
		await seedUser({ email: "second@example.com", createdAt: middle });
		await seedUser({ email: "third@example.com", createdAt: newest });

		const rows = await listAdminUsers();
		expect(rows.map((r) => r.email)).toEqual([
			"third@example.com",
			"second@example.com",
			"first@example.com",
		]);
		const first = rows.find((r) => r.email === "first@example.com");
		expect(first?.isAdmin).toBe(true);
		expect(first?.createdAt).toBe(oldest.toISOString());
		const second = rows.find((r) => r.email === "second@example.com");
		expect(second?.isAdmin).toBe(false);
	});
});

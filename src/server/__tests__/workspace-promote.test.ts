import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project as projectTable, user as userTable } from "#/db/schema";
import { createTestDb, type TestDb } from "#/test/with-pglite";

// Per-test PGLite DB injected into the #/db singleton (same pattern as
// workspace-store.test.ts).
let testDb: TestDb;
vi.mock("#/db", () => ({
	get db() {
		return testDb;
	},
}));

// promoteBranchProject stamps a "promoted" history marker, so unlike the other
// store tests we give it a *working* fake repo: a handle whose `change` runs
// the callback against an in-memory doc, plus a no-op `flush`.
// Each find() hands back a fresh in-memory doc + handle so no state leaks
// between tests (a future doc-history assertion would otherwise be
// order-dependent on the shared singleton).
vi.mock("#/server/automerge-server.server", () => ({
	getServerRepo: () => ({
		find: async () => {
			const doc: Record<string, unknown> = {};
			return { change: (fn: (d: Record<string, unknown>) => void) => fn(doc) };
		},
		flush: async () => {},
	}),
}));

const { ensurePersonalWorkspace, promoteBranchProject } = await import(
	"#/server/workspace-store.server"
);

async function seedUser(email = "ada@example.com", name = "Ada") {
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

async function insertProject(opts: {
	id: string;
	workspaceId: string;
	createdBy: string;
	parentProjectId?: string | null;
	branched?: boolean;
}) {
	await testDb.insert(projectTable).values({
		id: opts.id,
		workspaceId: opts.workspaceId,
		title: opts.id,
		automergeDocUrl: `automerge:${opts.id}-${Math.random().toString(36).slice(2, 8)}`,
		createdBy: opts.createdBy,
		parentProjectId: opts.parentProjectId ?? null,
		branchedFromHeads: opts.branched ? JSON.stringify(["h1"]) : null,
		branchedAt: opts.branched ? new Date() : null,
	});
}

async function readProject(id: string) {
	const rows = await testDb
		.select()
		.from(projectTable)
		.where(eq(projectTable.id, id))
		.limit(1);
	return rows[0];
}

describe("promoteBranchProject (against PGLite)", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
	});

	afterEach(async () => {
		await ctx.close();
	});

	it("clears the branch's lineage fields", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		await insertProject({ id: "root", workspaceId, createdBy: userId });
		await insertProject({
			id: "branch",
			workspaceId,
			createdBy: userId,
			parentProjectId: "root",
			branched: true,
		});

		await promoteBranchProject({ projectId: "branch" });

		const promoted = await readProject("branch");
		expect(promoted.parentProjectId).toBeNull();
		expect(promoted.branchedFromHeads).toBeNull();
		expect(promoted.branchedAt).toBeNull();
	});

	it("leaves the promoted project's own sub-branches attached to it", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		// A -> B -> C; promote B.
		await insertProject({ id: "A", workspaceId, createdBy: userId });
		await insertProject({
			id: "B",
			workspaceId,
			createdBy: userId,
			parentProjectId: "A",
			branched: true,
		});
		await insertProject({
			id: "C",
			workspaceId,
			createdBy: userId,
			parentProjectId: "B",
			branched: true,
		});

		await promoteBranchProject({ projectId: "B" });

		expect((await readProject("B")).parentProjectId).toBeNull();
		// C still points at B — the subtree rides along under the now-root B.
		expect((await readProject("C")).parentProjectId).toBe("B");
	});

	it("throws when the project doesn't exist", async () => {
		await expect(
			promoteBranchProject({ projectId: "missing" }),
		).rejects.toThrow(/not found/i);
	});

	it("refuses to promote a root project (no parent to detach from)", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		await insertProject({ id: "root", workspaceId, createdBy: userId });
		await expect(promoteBranchProject({ projectId: "root" })).rejects.toThrow(
			/only branches can be promoted/i,
		);
		// The row is untouched — still a root, no lineage scribbled.
		expect((await readProject("root")).parentProjectId).toBeNull();
	});
});

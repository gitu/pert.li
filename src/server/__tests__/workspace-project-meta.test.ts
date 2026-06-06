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

// updateProjectMeta keeps the Automerge doc's title in sync via getServerRepo.
// Capture the change() calls through a fake repo so we can both (a) keep the
// title path from spinning a real sync server and (b) assert it actually fires.
type ChangeCall = { doc: { title?: string }; options: unknown };
const changeCalls: ChangeCall[] = [];
const findUrls: string[] = [];
vi.mock("#/server/automerge-server.server", () => ({
	getServerRepo: () => ({
		find: async (url: string) => {
			findUrls.push(url);
			return {
				change: (
					mutator: (doc: { title?: string }) => void,
					options: unknown,
				) => {
					const doc: { title?: string } = {};
					mutator(doc);
					changeCalls.push({ doc, options });
				},
			};
		},
	}),
}));

const { updateProjectMeta, ensurePersonalWorkspace, listProjectsForWorkspace } =
	await import("#/server/workspace-store.server");

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

async function seedProject(
	workspaceId: string,
	createdBy: string,
	opts?: { title?: string; description?: string | null },
) {
	const id = `prj_${Math.random().toString(36).slice(2, 10)}`;
	await testDb.insert(projectTable).values({
		id,
		workspaceId,
		title: opts?.title ?? "Original title",
		description: opts?.description ?? null,
		automergeDocUrl: `automerge:${Math.random().toString(36).slice(2, 14)}`,
		createdBy,
	});
	return id;
}

describe("updateProjectMeta (against PGLite)", () => {
	let ctx: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		ctx = await createTestDb();
		testDb = ctx.db;
		changeCalls.length = 0;
		findUrls.length = 0;
	});

	afterEach(async () => {
		await ctx.close();
	});

	it("updates the title in the DB and syncs it into the Automerge doc", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		const projectId = await seedProject(workspaceId, userId);

		await updateProjectMeta({ projectId, title: "Renamed plan" });

		const [row] = await listProjectsForWorkspace(workspaceId);
		expect(row.title).toBe("Renamed plan");
		// Title change mirrors into the doc so JSON exports don't drift.
		expect(changeCalls).toHaveLength(1);
		expect(changeCalls[0].doc.title).toBe("Renamed plan");
	});

	it("updates the description without touching the Automerge doc", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		const projectId = await seedProject(workspaceId, userId);

		await updateProjectMeta({
			projectId,
			description: "One-line summary visible in the sidebar",
		});

		const [row] = await listProjectsForWorkspace(workspaceId);
		expect(row.description).toBe("One-line summary visible in the sidebar");
		expect(row.title).toBe("Original title");
		// Description-only edits never spin the sync server.
		expect(changeCalls).toHaveLength(0);
	});

	it("trims the title and rejects an empty/whitespace one", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		const projectId = await seedProject(workspaceId, userId);

		await updateProjectMeta({ projectId, title: "  Padded title  " });
		const [trimmed] = await listProjectsForWorkspace(workspaceId);
		expect(trimmed.title).toBe("Padded title");

		await expect(
			updateProjectMeta({ projectId, title: "   " }),
		).rejects.toThrow(/empty/i);
	});

	it("normalises a blank description to null (clearing it)", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		const projectId = await seedProject(workspaceId, userId, {
			description: "had one before",
		});

		await updateProjectMeta({ projectId, description: "   " });
		const [row] = await listProjectsForWorkspace(workspaceId);
		expect(row.description).toBeNull();
	});

	it("is a no-op when neither field is provided", async () => {
		const userId = await seedUser();
		const workspaceId = await ensurePersonalWorkspace(userId, "Ada");
		const projectId = await seedProject(workspaceId, userId, {
			title: "Keep me",
			description: "and me",
		});

		await updateProjectMeta({ projectId });
		const [row] = await listProjectsForWorkspace(workspaceId);
		expect(row.title).toBe("Keep me");
		expect(row.description).toBe("and me");
		expect(changeCalls).toHaveLength(0);
	});
});

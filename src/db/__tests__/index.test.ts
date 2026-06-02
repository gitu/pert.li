import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Regression tests for the first-run local-PGLite developer experience.
//
// Bug 1 — fresh checkout / git worktree: the gitignored ./.data directory
// doesn't exist yet, and PGlite's NodeFS backend mkdirs its data dir
// NON-recursively, so init must create the full path itself — otherwise
// `pnpm dev` dies before listening, with the real ENOENT swallowed by
// drizzle-kit's process.exit(1).
//
// Bug 2 — the nitro dev worker evaluates #/db in its own module graph, so
// the vite plugin's pre-warm can't hand over its instance. Server code
// (Better Auth, workspace store, …) accesses the `db` proxy without ever
// calling ensureDb(); the module's top-level await has to cover local
// PGLite in dev, or every DB-touching request 500s with "db accessed
// before init".
describe("local PGLite first run", () => {
	const tempRoot = mkdtempSync(path.join(tmpdir(), "pertli-pglite-"));
	const dataDir = path.join(tempRoot, "does", "not", "exist", "pglite");

	afterAll(async () => {
		// Close whatever instance is still open so the worker exits cleanly.
		const { closeDb } = await import("#/db/index");
		await closeDb();
		vi.unstubAllEnvs();
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it("module import alone boots PGLite into a data dir whose parents don't exist (dev-worker scenario)", {
		timeout: 60_000,
	}, async () => {
		expect(existsSync(path.dirname(dataDir))).toBe(false);

		vi.stubEnv("DATABASE_URL", "");
		vi.stubEnv("E2E_PGLITE", "");
		vi.stubEnv("LOCAL_PGLITE_DIR", dataDir);

		// What Better Auth & co. do: import the module and use the `db`
		// proxy directly — no explicit ensureDb() call anywhere.
		const { db } = await import("#/db/index");

		// The data dir was created and the schema push succeeded — the DB
		// answers queries against a pushed table through the proxy.
		expect(existsSync(dataDir)).toBe(true);
		const schema = await import("#/db/schema");
		const users = await db.select().from(schema.user);
		expect(users).toEqual([]);
	});

	it("pre-warm cycle: data written before closeDb() is visible after reopening (plugin → worker handoff)", {
		timeout: 60_000,
	}, async () => {
		// Runs after the previous test: same module instance, same data dir.
		const { ensureDb, closeDb } = await import("#/db/index");
		const schema = await import("#/db/schema");

		const db = await ensureDb();
		await db.insert(schema.user).values({
			id: "user_prewarm",
			name: "Pre Warm",
			email: "prewarm@example.com",
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		// What pglite-vite-plugin.ts does after pushing the schema.
		await closeDb();

		// What the nitro dev worker does next: open its own instance on the
		// same dir. The row written before the close must be there.
		const reopened = await ensureDb();
		const users = await reopened
			.select({ id: schema.user.id })
			.from(schema.user);
		expect(users).toEqual([{ id: "user_prewarm" }]);
	});
});

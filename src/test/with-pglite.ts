import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "#/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

/** Spin up a fresh in-process Postgres and push the current schema against
 * it. Each call returns a brand-new isolated DB plus a close handle. Pair
 * with `vi.mock("#/db", ...)` and a `beforeEach(() => { testDb = ... })`
 * to test the SQL-level workspace / project / audit-log paths in
 * isolation, without touching Neon. */
export async function createTestDb(): Promise<{
	db: TestDb;
	close(): Promise<void>;
}> {
	const client = new PGlite();
	const db = drizzle(client, { schema });
	// See note in src/db/index.ts — pushSchema's parameter type erases the
	// schema generic, so cast through unknown.
	const { apply } = await pushSchema(
		schema,
		db as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();
	return {
		db,
		async close() {
			await client.close();
		},
	};
}

/** Convenience wrapper for one-off tests:
 *
 *     await withPglite(async (db) => {
 *       await db.insert(user).values({...});
 *       // ...
 *     });
 *
 * Closes the in-process DB even when the body throws. Prefer the explicit
 * `createTestDb()` form if you need to reuse the instance across multiple
 * `it()` calls inside the same `describe`. */
export async function withPglite<T>(
	body: (db: TestDb) => Promise<T>,
): Promise<T> {
	const ctx = await createTestDb();
	try {
		return await body(ctx.db);
	} finally {
		await ctx.close();
	}
}

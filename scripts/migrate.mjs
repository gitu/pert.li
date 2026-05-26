#!/usr/bin/env node
// Apply SQL migrations from ./drizzle/ to the database in DATABASE_URL.
//
// Used by the container entrypoint so a fresh deployment boots into a
// working schema. Idempotent — drizzle-orm/migrator keeps a journal in the
// `__drizzle_migrations` table and skips already-applied files.
//
// We use the programmatic node-postgres migrator instead of `drizzle-kit
// migrate` so prod images don't need to ship `tsx`, `dotenv`, or the TS
// `drizzle.config.ts` source. Everything below runs against the bundled JS
// in production node_modules.

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("[migrate] DATABASE_URL is not set");
	process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

try {
	const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_FOLDER ?? "./drizzle";
	console.log(`[migrate] Applying migrations from ${migrationsFolder}`);
	await migrate(db, { migrationsFolder });
	console.log("[migrate] Done");
} catch (err) {
	console.error("[migrate] Failed:", err);
	process.exitCode = 1;
} finally {
	await pool.end();
}

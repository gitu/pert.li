import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

// Both real and test drivers share this shape — Drizzle's PgDatabase is the
// common base. Callers only use query methods, so this is enough.
type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema> &
	Record<string, unknown>;

let _db: AppDatabase | undefined;
let _initPromise: Promise<AppDatabase> | undefined;

async function init(): Promise<AppDatabase> {
	// E2E mode: in-process Postgres via PGLite. The schema is pushed
	// programmatically on first init so tests start against an empty,
	// fully-migrated DB without a separate setup step.
	if (process.env.E2E_PGLITE === "1") {
		const [{ PGlite }, pgliteDriver, { pushSchema }] = await Promise.all([
			import("@electric-sql/pglite"),
			import("drizzle-orm/pglite"),
			import("drizzle-kit/api"),
		]);
		const client = new PGlite(); // memory-only
		const drizzleDb = pgliteDriver.drizzle(client, { schema });
		const { apply } = await pushSchema(schema, drizzleDb);
		await apply();
		return drizzleDb as unknown as AppDatabase;
	}

	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. In dev, the neon vite plugin should provision it on first start.",
		);
	}
	return drizzle(neon(url), { schema }) as unknown as AppDatabase;
}

export async function ensureDb(): Promise<AppDatabase> {
	if (_db) return _db;
	if (!_initPromise) {
		_initPromise = init().then((d) => {
			_db = d;
			return d;
		});
	}
	return _initPromise;
}

export function getDb(): AppDatabase {
	if (!_db) {
		throw new Error(
			"db accessed before init. In e2e mode call `await ensureDb()` once at startup; in normal mode the first import is sync.",
		);
	}
	return _db;
}

// In e2e mode the PGLite init is async (the schema push), so we eagerly
// resolve it at module load via top-level await. The dev-server's readiness
// probe then doesn't return until the DB is ready. In production the
// neon-http driver is sync to construct and the proxy below initializes
// lazily on first property access.
if (process.env.E2E_PGLITE === "1") {
	await ensureDb();
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
	get: (_target, prop, receiver) => {
		if (!_db) {
			const url = process.env.DATABASE_URL;
			if (!url)
				throw new Error("DATABASE_URL is not set. See src/db/index.ts.");
			_db = drizzle(neon(url), { schema }) as unknown as AppDatabase;
		}
		return Reflect.get(_db, prop, receiver);
	},
});

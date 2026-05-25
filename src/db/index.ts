import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

// Both real and test drivers share this shape — Drizzle's PgDatabase is the
// common base. Callers only use query methods, so this is enough.
type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema> &
	Record<string, unknown>;

const DEFAULT_LOCAL_PGLITE_DIR = "./.data/pglite";

type DbMode = "e2e-pglite" | "local-pglite" | "neon";

function resolveMode(): DbMode {
	if (process.env.E2E_PGLITE === "1") return "e2e-pglite";
	// Opt-in via LOCAL_PGLITE=1, OR opt-in by absence of DATABASE_URL — that
	// way `pnpm dev` works zero-config the first time without Neon launchpad,
	// and a developer that wants real Neon just provisions DATABASE_URL.
	if (
		process.env.LOCAL_PGLITE === "1" ||
		!process.env.DATABASE_URL ||
		process.env.DATABASE_URL.trim() === ""
	) {
		return "local-pglite";
	}
	return "neon";
}

async function initPglite(dataDir?: string): Promise<AppDatabase> {
	// `drizzle-kit/api` re-exports every Drizzle driver entry point (mysql2,
	// aws-data-api, singlestore, …) — most of those have optional peer deps
	// that aren't installed in this repo, so when Rolldown follows the
	// dynamic-import string at build time it trips MISSING_EXPORT errors.
	// PGLite paths only run in dev / e2e, so we tell the bundler to ignore
	// the specifier; at runtime the module is resolved normally.
	const [{ PGlite }, pgliteDriver, { pushSchema }] = await Promise.all([
		import("@electric-sql/pglite"),
		import("drizzle-orm/pglite"),
		import(/* @vite-ignore */ "drizzle-kit/api"),
	]);
	const client = dataDir ? new PGlite(dataDir) : new PGlite();
	const drizzleDb = pgliteDriver.drizzle(client, { schema });
	const { apply } = await pushSchema(schema, drizzleDb);
	await apply();
	return drizzleDb as unknown as AppDatabase;
}

let _db: AppDatabase | undefined;
let _initPromise: Promise<AppDatabase> | undefined;

async function init(): Promise<AppDatabase> {
	const mode = resolveMode();
	if (mode === "e2e-pglite") {
		// Fresh in-memory DB per server start so tests don't see prior state.
		return initPglite();
	}
	if (mode === "local-pglite") {
		const dir = process.env.LOCAL_PGLITE_DIR ?? DEFAULT_LOCAL_PGLITE_DIR;
		console.log(`[db] Using local PGLite at ${dir} (no DATABASE_URL set)`);
		return initPglite(dir);
	}
	// Production / Neon-backed: synchronous driver, no schema push (managed
	// out-of-band via `pnpm db:push` / migrations).
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. Set it to a Postgres URL, or unset it (and remove LOCAL_PGLITE=0) to use the local PGLite fallback.",
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
			"db accessed before init. PGLite paths are async — call `await ensureDb()` once at startup.",
		);
	}
	return _db;
}

// E2E mode: in-process, throw-away DB per server start. The schema push is
// async, so we resolve it at module load via top-level await. Playwright
// only probes once Vite reports ready, so this is safe in the test harness.
//
// Local dev (PGLite on disk) is *not* eagerly initialized here because top-
// level await blocks the SSR module graph, racing with Vite's HMR WS
// upgrade through Nitro's proxy. Instead, the Vite plugin in
// `pglite-vite-plugin.ts` calls `ensureDb()` during `configureServer` so
// the DB is ready before the server starts listening.
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

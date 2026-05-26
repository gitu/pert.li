import { neon } from "@neondatabase/serverless";
import {
	drizzle as drizzleNeonHttp,
	type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema.ts";

// Both real and test drivers share this shape — Drizzle's PgDatabase is the
// common base. Callers only use query methods, so this is enough.
type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema> &
	Record<string, unknown>;

const DEFAULT_LOCAL_PGLITE_DIR = "./.data/pglite";

type DbMode = "e2e-pglite" | "local-pglite" | "neon" | "pg";

// Hostnames that should go through the Neon HTTP driver instead of plain
// node-postgres. The serverless driver only speaks Neon's SQL-over-HTTP
// protocol, so on-prem Postgres / Cloud SQL / RDS need the regular driver.
const NEON_HOST_PATTERNS = [
	/\.neon\.tech$/i,
	/\.neondb\.com$/i,
	/\.neon\.build$/i,
];

function isNeonUrl(url: string): boolean {
	if (process.env.DB_DRIVER === "neon") return true;
	if (process.env.DB_DRIVER === "pg") return false;
	try {
		const u = new URL(url);
		return NEON_HOST_PATTERNS.some((re) => re.test(u.hostname));
	} catch {
		return false;
	}
}

function resolveMode(): DbMode {
	if (process.env.E2E_PGLITE === "1") return "e2e-pglite";
	// Opt-in via LOCAL_PGLITE=1, OR opt-in by absence of DATABASE_URL — that
	// way `pnpm dev` works zero-config the first time without Neon launchpad,
	// and a developer that wants real Neon just provisions DATABASE_URL. In
	// production we follow the same rule: no DATABASE_URL → in-process PGLite
	// (suitable for single-replica self-hosting on a PVC), DATABASE_URL set →
	// real Postgres.
	if (
		process.env.LOCAL_PGLITE === "1" ||
		!process.env.DATABASE_URL ||
		process.env.DATABASE_URL.trim() === ""
	) {
		return "local-pglite";
	}
	return isNeonUrl(process.env.DATABASE_URL) ? "neon" : "pg";
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
	// pushSchema's signature requires a PgDatabase whose schema generic erases
	// to `Record<string, never>`; our schema is well-typed which means TS sees
	// a structural mismatch on a field that's only ever read by pushSchema
	// itself. Cast through unknown — runtime behaviour is unaffected.
	const { apply } = await pushSchema(
		schema,
		drizzleDb as unknown as Parameters<typeof pushSchema>[1],
	);
	await apply();
	return drizzleDb as unknown as AppDatabase;
}

function initNeon(url: string): AppDatabase {
	return drizzleNeonHttp(neon(url), { schema }) as unknown as AppDatabase;
}

function initNodePg(url: string): AppDatabase {
	// node-postgres' Pool is the right shape for any vanilla Postgres
	// (self-hosted, RDS, Cloud SQL, Supabase direct, ...). Connections are
	// established lazily on first query, so this is safe to call synchronously
	// at module init.
	const pool = new Pool({ connectionString: url, max: 10 });
	return drizzleNodePg(pool, { schema }) as unknown as AppDatabase;
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
		console.log(`[db] Using PGLite at ${dir} (no DATABASE_URL set)`);
		return initPglite(dir);
	}
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. Set it to a Postgres URL, or unset it (and remove LOCAL_PGLITE=0) to use the PGLite fallback.",
		);
	}
	if (mode === "neon") {
		console.log("[db] Using Neon HTTP driver");
		return initNeon(url);
	}
	console.log("[db] Using node-postgres driver");
	return initNodePg(url);
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
//
// Production: the synchronous Proxy fallback below handles Neon and vanilla
// Postgres lazily on first access. PGLite-in-production is intentionally not
// wired here — drizzle-kit's `pushSchema` hangs against the Rolldown-bundled
// schema object (Drizzle's Symbol identities don't survive the bundling), so
// schema management for self-hosted deployments goes through the container
// entrypoint (`scripts/docker-entrypoint.sh`) which runs the unbundled
// `pnpm db:push` against a real Postgres before the server starts.
if (process.env.E2E_PGLITE === "1") {
	await ensureDb();
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
	get: (_target, prop, receiver) => {
		if (!_db) {
			// Synchronous fallback: only the URL-based drivers (Neon / node-pg)
			// can be constructed lazily here. PGLite paths must have gone through
			// ensureDb() during startup; getting here without an initialized _db
			// means the boot sequence missed its init hook.
			const url = process.env.DATABASE_URL;
			if (!url) {
				throw new Error(
					"db accessed before init and no DATABASE_URL is set. " +
						"Either call `await ensureDb()` at startup (PGLite paths) " +
						"or set DATABASE_URL (Neon / Postgres).",
				);
			}
			_db = isNeonUrl(url) ? initNeon(url) : initNodePg(url);
		}
		return Reflect.get(_db, prop, receiver);
	},
});

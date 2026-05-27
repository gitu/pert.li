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
//
// Baselining: when migrating an existing database from `drizzle-kit push`
// to this migrator (or restoring a schema dump that already contains
// every object), the schema is present but `drizzle.__drizzle_migrations`
// is empty — so drizzle would try to apply 0000 from scratch and crash
// with `42710 type "<...>" already exists`. Set `BASELINE_MIGRATIONS=1`
// on a single boot to mark every journal entry as applied without running
// its SQL, then clear the flag.
//
// Hash drift: drizzle's runtime migrator skips already-applied migrations
// by comparing `created_at` (not the recorded hash) against the journal's
// `when`. So if a migration is edited on disk after being applied —
// hand-fix, idempotization rewrite, accidental commit — the new SQL is
// never executed but the old hash sits in `__drizzle_migrations`. We
// detect this after every successful migrate() and log a warning per
// affected migration. Informational only; the warning itself is the
// signal. Operators can decide whether the on-disk edit was harmless
// (typo, comment, idempotization wrapper) or needs a follow-up migration.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export function readJournal(migrationsFolder) {
	const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
	return journal.entries.map((entry) => {
		const sql = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf-8");
		return {
			tag: entry.tag,
			folderMillis: entry.when,
			hash: crypto.createHash("sha256").update(sql).digest("hex"),
		};
	});
}

async function baseline(pool, migrationsFolder) {
	const entries = readJournal(migrationsFolder);
	const client = await pool.connect();
	try {
		const { rows } = await client.query(
			"SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
		);
		if (rows[0].n === 0) {
			throw new Error(
				"BASELINE_MIGRATIONS=1 but the `public` schema is empty — refusing to mark migrations applied against a blank database. Unset the flag and let migrations run normally.",
			);
		}
		await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
		await client.query(
			"CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
		);
		for (const entry of entries) {
			const res = await client.query(
				`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
				 SELECT $1, $2
				 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1)`,
				[entry.hash, entry.folderMillis],
			);
			if (res.rowCount > 0) {
				console.log(`[migrate] Baselined ${entry.tag}`);
			} else {
				console.log(`[migrate] Skipped ${entry.tag} (already recorded)`);
			}
		}
	} finally {
		client.release();
	}
}

/** Pure comparison between rows from `drizzle.__drizzle_migrations` and
 * the on-disk journal. Returns drift records, sorted by createdAt asc:
 *
 *   { kind: "hash-mismatch", tag, recordedHash, currentHash } — entry
 *      was applied, but its SQL file has changed since.
 *   { kind: "orphan-db-row", recordedHash, createdAt } — DB has a row
 *      with no matching journal entry (entry was deleted from disk).
 *
 * Journal entries present on disk but absent from the DB are not drift —
 * they're just not yet applied, which is the normal state for any new
 * migration. */
export function computeDrift(applied, entries) {
	const byMillis = new Map(entries.map((e) => [Number(e.folderMillis), e]));
	const drifts = [];
	for (const { hash, created_at } of applied) {
		const journal = byMillis.get(Number(created_at));
		if (!journal) {
			drifts.push({
				kind: "orphan-db-row",
				recordedHash: hash,
				createdAt: Number(created_at),
			});
			continue;
		}
		if (journal.hash !== hash) {
			drifts.push({
				kind: "hash-mismatch",
				tag: journal.tag,
				recordedHash: hash,
				currentHash: journal.hash,
			});
		}
	}
	return drifts;
}

async function readAppliedMigrations(queryable) {
	try {
		const res = await queryable.query(
			"SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC",
		);
		return res.rows;
	} catch (err) {
		// 42P01 = relation does not exist. Pre-first-apply, nothing to compare.
		if (err?.code === "42P01") return [];
		throw err;
	}
}

/** Compare the hash drizzle recorded in `drizzle.__drizzle_migrations`
 * against the current on-disk hash for each applied journal entry.
 * Returns drift records (see `computeDrift`) or `[]` if the migration
 * table doesn't exist yet (fresh DB). Pure read; no writes. */
export async function checkHashDrift(pool, migrationsFolder) {
	const client = await pool.connect();
	try {
		const applied = await readAppliedMigrations(client);
		return computeDrift(applied, readJournal(migrationsFolder));
	} finally {
		client.release();
	}
}

function logHashDrift(drifts) {
	if (drifts.length === 0) return;
	console.warn(
		`[migrate] ⚠ ${drifts.length} migration(s) drifted from their recorded hash. The on-disk SQL changed after being applied — the new SQL has not been executed:`,
	);
	for (const drift of drifts) {
		if (drift.kind === "hash-mismatch") {
			console.warn(`[migrate]   - ${drift.tag}: db=${drift.recordedHash.slice(0, 12)}… disk=${drift.currentHash.slice(0, 12)}…`);
		} else {
			console.warn(
				`[migrate]   - orphan row (created_at=${drift.createdAt}, db=${drift.recordedHash.slice(0, 12)}…) has no matching journal entry`,
			);
		}
	}
	console.warn(
		"[migrate]   Inspect the diff; if the change was intended (typo, comment, idempotization), it's harmless. If it added new SQL, write a follow-up migration to apply it.",
	);
}

function isAlreadyExistsError(err) {
	const code = err?.cause?.code ?? err?.code;
	return code === "42710" || code === "42P07";
}

const HINT_ALREADY_EXISTS = [
	"",
	"[migrate] Hint: the schema already contains the objects this migration creates, but `drizzle.__drizzle_migrations` does not record it as applied.",
	"[migrate] This is the expected state when switching an existing database from `drizzle-kit push` to migrations.",
	"[migrate] Recover by booting once with `BASELINE_MIGRATIONS=1` to mark current journal entries as applied without re-running their SQL, then clear the flag.",
].join("\n");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error("[migrate] DATABASE_URL is not set");
		process.exit(1);
	}

	const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_FOLDER ?? "./drizzle";
	const pool = new Pool({ connectionString: url, max: 1 });
	const db = drizzle(pool);

	try {
		if (process.env.BASELINE_MIGRATIONS === "1") {
			console.log(`[migrate] BASELINE_MIGRATIONS=1 — marking ${migrationsFolder} entries as applied (no SQL run)`);
			await baseline(pool, migrationsFolder);
			console.log("[migrate] Baseline complete");
		} else {
			console.log(`[migrate] Applying migrations from ${migrationsFolder}`);
			await migrate(db, { migrationsFolder });
			console.log("[migrate] Done");
			logHashDrift(await checkHashDrift(pool, migrationsFolder));
		}
	} catch (err) {
		console.error("[migrate] Failed:", err);
		if (isAlreadyExistsError(err)) {
			console.error(HINT_ALREADY_EXISTS);
		}
		process.exitCode = 1;
	} finally {
		await pool.end();
	}
}

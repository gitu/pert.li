import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { checkHashDrift, computeDrift, readJournal } from "../migrate.mjs";

// migrate.mjs's `BASELINE_MIGRATIONS=1` path inserts rows into
// `drizzle.__drizzle_migrations` so drizzle's runtime migrator skips
// already-applied entries. The hash drizzle compares against is computed
// in `drizzle-orm/migrator.js` as sha256 of the raw .sql file contents.
// If a drizzle bump ever changes that algorithm, our baseline rows would
// silently no longer match — and migrate() would try to re-apply 0000.
// This test pins the two algorithms together.

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("readJournal", () => {
	it("yields the same hash drizzle's own readMigrationFiles produces", () => {
		const ours = readJournal(MIGRATIONS_FOLDER);
		const drizzles = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

		expect(ours).toHaveLength(drizzles.length);
		expect(ours.length).toBeGreaterThan(0);

		for (let i = 0; i < ours.length; i++) {
			expect(ours[i].hash).toBe(drizzles[i].hash);
			expect(ours[i].folderMillis).toBe(drizzles[i].folderMillis);
		}
	});

	it("computes the published hash of 0000_wet_gideon.sql", () => {
		// Stability anchor: this value is also documented in the SELF_HOSTING
		// recovery snippet. If it changes, the recovery doc needs updating.
		const entry = readJournal(MIGRATIONS_FOLDER).find((e) => e.tag === "0000_wet_gideon");
		expect(entry).toBeDefined();
		expect(entry.hash).toBe("7c56bd6b7f8981fd7fe9988aadbcab1fc14f8e1aa1bde0906a074b7820ac02e4");
		expect(entry.folderMillis).toBe(1779809908761);
		// And the SQL is what we expect to baseline — sanity check.
		const sql = readFileSync(`${MIGRATIONS_FOLDER}/0000_wet_gideon.sql`, "utf-8");
		expect(sql).toMatch(/CREATE TYPE "public"."workspace_role"/);
	});
});

describe("computeDrift", () => {
	const entries = [
		{ tag: "0000_first", folderMillis: 1000, hash: "aaa" },
		{ tag: "0001_second", folderMillis: 2000, hash: "bbb" },
	];

	it("returns [] when applied rows match the journal exactly", () => {
		expect(
			computeDrift(
				[
					{ hash: "aaa", created_at: 1000 },
					{ hash: "bbb", created_at: 2000 },
				],
				entries,
			),
		).toEqual([]);
	});

	it("returns [] when nothing has been applied yet", () => {
		expect(computeDrift([], entries)).toEqual([]);
	});

	it("reports hash-mismatch when an applied row's hash differs from the journal", () => {
		expect(
			computeDrift(
				[
					{ hash: "aaa", created_at: 1000 },
					{ hash: "STALE", created_at: 2000 },
				],
				entries,
			),
		).toEqual([
			{ kind: "hash-mismatch", tag: "0001_second", recordedHash: "STALE", currentHash: "bbb" },
		]);
	});

	it("reports orphan-db-row when the journal entry has been deleted", () => {
		expect(computeDrift([{ hash: "ccc", created_at: 9999 }], entries)).toEqual([
			{ kind: "orphan-db-row", recordedHash: "ccc", createdAt: 9999 },
		]);
	});

	it("coerces created_at strings (postgres bigint comes back as string) to numbers", () => {
		expect(computeDrift([{ hash: "aaa", created_at: "1000" }], entries)).toEqual([]);
	});

	it("treats unapplied journal entries as not-drift", () => {
		// Entry 0 applied, entry 1 not yet — that's the normal not-yet-deployed
		// state, not drift.
		expect(computeDrift([{ hash: "aaa", created_at: 1000 }], entries)).toEqual([]);
	});
});

describe("checkHashDrift", () => {
	// PGlite exposes the same `query(text, params)` shape as a pg client,
	// so we can hand it to checkHashDrift via a tiny pool-shaped adapter.
	function pglitePool(pg) {
		return {
			connect: async () => ({
				query: (text, params) => pg.query(text, params),
				release: () => {},
			}),
		};
	}

	it("returns [] when drizzle.__drizzle_migrations does not exist yet", async () => {
		const pg = new PGlite();
		try {
			const drifts = await checkHashDrift(pglitePool(pg), MIGRATIONS_FOLDER);
			expect(drifts).toEqual([]);
		} finally {
			await pg.close();
		}
	});

	it("returns [] when the recorded hash matches the current journal hash", async () => {
		const pg = new PGlite();
		try {
			const entry = readJournal(MIGRATIONS_FOLDER)[0];
			await pg.exec(`
				CREATE SCHEMA drizzle;
				CREATE TABLE drizzle.__drizzle_migrations (
					id SERIAL PRIMARY KEY,
					hash text NOT NULL,
					created_at bigint
				);
			`);
			await pg.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [
				entry.hash,
				entry.folderMillis,
			]);
			const drifts = await checkHashDrift(pglitePool(pg), MIGRATIONS_FOLDER);
			expect(drifts).toEqual([]);
		} finally {
			await pg.close();
		}
	});

	it("reports drift when the recorded hash is stale", async () => {
		const pg = new PGlite();
		try {
			const entry = readJournal(MIGRATIONS_FOLDER)[0];
			await pg.exec(`
				CREATE SCHEMA drizzle;
				CREATE TABLE drizzle.__drizzle_migrations (
					id SERIAL PRIMARY KEY,
					hash text NOT NULL,
					created_at bigint
				);
			`);
			const staleHash = "0".repeat(64);
			await pg.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [
				staleHash,
				entry.folderMillis,
			]);
			const drifts = await checkHashDrift(pglitePool(pg), MIGRATIONS_FOLDER);
			expect(drifts).toHaveLength(1);
			expect(drifts[0]).toMatchObject({
				kind: "hash-mismatch",
				tag: entry.tag,
				recordedHash: staleHash,
				currentHash: entry.hash,
			});
		} finally {
			await pg.close();
		}
	});
});

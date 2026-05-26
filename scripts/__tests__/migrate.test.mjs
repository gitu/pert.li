import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { readJournal } from "../migrate.mjs";

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

	it("returns the journal entries we expect for 0000_wet_gideon", () => {
		const entry = readJournal(MIGRATIONS_FOLDER).find((e) => e.tag === "0000_wet_gideon");
		expect(entry).toBeDefined();
		expect(entry.folderMillis).toBe(1779809908761);
		expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
		// Sanity-check the SQL is what we expect to baseline. The CREATE TYPE
		// statement is wrapped in a DO block by `db-make-idempotent.mjs` so
		// re-applying is safe — that's why we don't match against a literal
		// `CREATE TYPE ... AS ENUM` prefix.
		const sql = readFileSync(`${MIGRATIONS_FOLDER}/0000_wet_gideon.sql`, "utf-8");
		expect(sql).toMatch(/CREATE TYPE "public"\."workspace_role"/);
		expect(sql).toMatch(/EXCEPTION\s+WHEN duplicate_object THEN null/);
	});
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { transformSql, transformStatement } from "../db-make-idempotent.mjs";

const REAL_0000 = fileURLToPath(new URL("../../drizzle/0000_wet_gideon.sql", import.meta.url));

describe("transformStatement", () => {
	it("guards CREATE TYPE in a DO block (no IF NOT EXISTS for types)", () => {
		const out = transformStatement(`CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'editor', 'viewer');`);
		expect(out).toContain("DO $$ BEGIN");
		expect(out).toContain("EXCEPTION");
		expect(out).toContain("WHEN duplicate_object THEN null");
		expect(out).toContain("END $$;");
		expect(out).toContain(`CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'editor', 'viewer');`);
	});

	it("makes CREATE TABLE idempotent", () => {
		const out = transformStatement(`CREATE TABLE "account" ("id" text PRIMARY KEY NOT NULL)`);
		expect(out).toBe(`CREATE TABLE IF NOT EXISTS "account" ("id" text PRIMARY KEY NOT NULL)`);
	});

	it("makes CREATE INDEX idempotent", () => {
		expect(transformStatement(`CREATE INDEX "k_idx" ON "t" USING btree ("k");`)).toBe(
			`CREATE INDEX IF NOT EXISTS "k_idx" ON "t" USING btree ("k");`,
		);
	});

	it("makes CREATE UNIQUE INDEX idempotent", () => {
		expect(transformStatement(`CREATE UNIQUE INDEX "u_idx" ON "t" ("a","b");`)).toBe(
			`CREATE UNIQUE INDEX IF NOT EXISTS "u_idx" ON "t" ("a","b");`,
		);
	});

	it("makes CREATE SCHEMA idempotent", () => {
		expect(transformStatement(`CREATE SCHEMA "foo";`)).toBe(`CREATE SCHEMA IF NOT EXISTS "foo";`);
	});

	it("guards ALTER TABLE ADD CONSTRAINT in a DO block (no IF NOT EXISTS pre-PG17)", () => {
		const out = transformStatement(
			`ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;`,
		);
		expect(out).toContain("DO $$ BEGIN");
		expect(out).toContain("WHEN duplicate_object THEN null");
		expect(out).toContain(`ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY`);
	});

	it("makes ALTER TABLE ADD COLUMN idempotent", () => {
		expect(transformStatement(`ALTER TABLE "user" ADD COLUMN "new_col" text;`)).toBe(
			`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "new_col" text;`,
		);
	});

	it("leaves already-idempotent statements alone", () => {
		const inputs = [
			`CREATE TABLE IF NOT EXISTS "x" ("a" text);`,
			`CREATE INDEX IF NOT EXISTS "i" ON "x" ("a");`,
			`CREATE SCHEMA IF NOT EXISTS "drizzle";`,
			`DO $$ BEGIN CREATE TYPE x AS ENUM('a'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
		];
		for (const input of inputs) {
			expect(transformStatement(input)).toBe(input);
		}
	});

	it("preserves the leading & trailing whitespace from a multi-line chunk", () => {
		const chunk = `\nCREATE TABLE "x" (\n\t"a" text\n);\n`;
		const out = transformStatement(chunk);
		expect(out.startsWith("\n")).toBe(true);
		expect(out.endsWith("\n")).toBe(true);
		expect(out).toContain(`CREATE TABLE IF NOT EXISTS "x"`);
	});

	it("ignores empty chunks (e.g. a trailing breakpoint)", () => {
		expect(transformStatement("")).toBe("");
		expect(transformStatement("\n\n")).toBe("\n\n");
	});
});

describe("transformSql", () => {
	it("preserves all statement-breakpoint separators", () => {
		const input = `CREATE TYPE x AS ENUM('a');--> statement-breakpoint\nCREATE TABLE y (a text);`;
		const out = transformSql(input);
		expect(out.split("--> statement-breakpoint")).toHaveLength(2);
	});

	it("is a fixed point: applying twice yields the same result", () => {
		const input = readFileSync(REAL_0000, "utf-8");
		const once = transformSql(input);
		const twice = transformSql(once);
		expect(twice).toBe(once);
	});
});

describe("idempotency against a real Postgres", () => {
	it("the rewritten 0000_wet_gideon.sql applies cleanly twice to PGlite", async () => {
		const rewritten = transformSql(readFileSync(REAL_0000, "utf-8"));
		const pg = new PGlite();
		try {
			await pg.exec(rewritten);
			// Second application against the same DB — should be a complete no-op.
			await pg.exec(rewritten);
			const { rows } = await pg.query(
				"SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
			);
			expect(rows[0].n).toBeGreaterThan(0);
		} finally {
			await pg.close();
		}
	});
});

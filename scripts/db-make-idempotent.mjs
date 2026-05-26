#!/usr/bin/env node
// Rewrite drizzle-kit generated migrations to be safe to re-apply.
//
// Drizzle generates `CREATE TYPE / CREATE TABLE / ALTER ... ADD CONSTRAINT`
// without idempotency guards. That's a problem in production: if the
// schema is already present (e.g. switching a DB from `drizzle-kit push`
// to migrations, restoring a schema dump, recovering from a partial
// apply), re-running the migration crashes with `42710 already exists`
// or `42P07 relation already exists`. We hit this on the Cloud Run
// deploy on 2026-05-26.
//
// This script rewrites each statement in `./drizzle/NNNN_*.sql` to its
// idempotent equivalent:
//
//   CREATE TYPE "x"."y" AS ENUM(...);  ─► DO $$ BEGIN <stmt>;
//                                            EXCEPTION
//                                              WHEN duplicate_object THEN null;
//                                            END $$;
//   CREATE TABLE "x" (...)             ─► CREATE TABLE IF NOT EXISTS "x" (...)
//   CREATE [UNIQUE] INDEX "x" ...      ─► CREATE [UNIQUE] INDEX IF NOT EXISTS "x" ...
//   CREATE SCHEMA "x"                  ─► CREATE SCHEMA IF NOT EXISTS "x"
//   ALTER TABLE "x" ADD CONSTRAINT "y" ─► DO $$ BEGIN <stmt>;
//                                            EXCEPTION
//                                              WHEN duplicate_object THEN null;
//                                            END $$;
//   ALTER TABLE "x" ADD COLUMN "y" ... ─► ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" ...
//
// Drizzle's runtime migrator (drizzle-orm/migrator) decides whether to
// skip an already-applied migration by comparing the journal entry's
// `when` (folderMillis) to the last `created_at` row in
// `drizzle.__drizzle_migrations`. The hash recorded alongside is a
// fingerprint, not a freshness check — so rewriting the SQL of an
// already-applied migration does NOT trigger a re-apply. Safe.
//
// Pipeline: `pnpm db:generate` calls drizzle-kit, then this script. Run
// it manually with `node scripts/db-make-idempotent.mjs` to re-process
// existing files (e.g. after pulling a branch that added one).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
const DUPLICATE_OBJECT_GUARD = ["EXCEPTION", "\tWHEN duplicate_object THEN null;", "END $$;"].join("\n");

/** Wrap a statement so re-applying it against an existing object is a
 * silent no-op. Used for `CREATE TYPE` (Postgres has no
 * `CREATE TYPE IF NOT EXISTS`) and `ALTER TABLE ... ADD CONSTRAINT`
 * (which also has no IF NOT EXISTS form before PG 17). The
 * `duplicate_object` SQLSTATE covers both. */
function wrapWithDuplicateObjectGuard(statement) {
	const trimmed = statement.trimEnd().replace(/;$/, "");
	return `DO $$ BEGIN\n\t${trimmed};\n${DUPLICATE_OBJECT_GUARD}`;
}

/** Apply idempotency to a single SQL statement (one chunk from
 * `split('--> statement-breakpoint')`). Already-guarded statements pass
 * through unchanged so running this twice is a fixed point. */
export function transformStatement(chunk) {
	if (!chunk.trim()) return chunk;

	const leadingWs = chunk.match(/^\s*/)[0];
	const trailingWs = chunk.match(/\s*$/)[0];
	const body = chunk.slice(leadingWs.length, chunk.length - trailingWs.length);

	const rewritten = rewriteBody(body);
	return rewritten === body ? chunk : `${leadingWs}${rewritten}${trailingWs}`;
}

function rewriteBody(body) {
	// Already-guarded DO blocks: leave alone.
	if (/^DO\s+\$\$/i.test(body)) return body;

	// CREATE SCHEMA "x"  ─►  CREATE SCHEMA IF NOT EXISTS "x"
	if (/^CREATE\s+SCHEMA\s+(?!IF\s+NOT\s+EXISTS\b)/i.test(body)) {
		return body.replace(/^(CREATE\s+SCHEMA)\s+/i, "$1 IF NOT EXISTS ");
	}

	// CREATE TABLE "x" (...)  ─►  CREATE TABLE IF NOT EXISTS "x" (...)
	if (/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i.test(body)) {
		return body.replace(/^(CREATE\s+TABLE)\s+/i, "$1 IF NOT EXISTS ");
	}

	// CREATE [UNIQUE] INDEX ...  ─►  CREATE [UNIQUE] INDEX IF NOT EXISTS ...
	if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/i.test(body)) {
		return body.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, "$1 IF NOT EXISTS ");
	}

	// CREATE TYPE ...  ─►  DO $$ BEGIN <stmt>; EXCEPTION WHEN duplicate_object THEN null; END $$;
	if (/^CREATE\s+TYPE\s+/i.test(body)) {
		return wrapWithDuplicateObjectGuard(body);
	}

	if (/^ALTER\s+TABLE\s+/i.test(body)) {
		// ALTER TABLE "x" ADD COLUMN "y" ...  ─►  ADD COLUMN IF NOT EXISTS "y" ...
		if (/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/i.test(body)) {
			return body.replace(/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\s+)/gi, "ADD COLUMN IF NOT EXISTS ");
		}
		// ALTER TABLE "x" ADD CONSTRAINT "y" ...  ─►  DO $$ BEGIN ... END $$;
		if (/\bADD\s+CONSTRAINT\s+/i.test(body)) {
			return wrapWithDuplicateObjectGuard(body);
		}
	}

	return body;
}

/** Apply idempotency to every statement in a migration file. Preserves
 * the `--> statement-breakpoint` separator so drizzle's migrator can
 * still split + execute statements one at a time. */
export function transformSql(sql) {
	return sql.split(STATEMENT_BREAKPOINT).map(transformStatement).join(STATEMENT_BREAKPOINT);
}

function rewriteFile(filePath) {
	const original = fs.readFileSync(filePath, "utf-8");
	const rewritten = transformSql(original);
	if (rewritten === original) return false;
	fs.writeFileSync(filePath, rewritten);
	return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const folder = process.argv[2] ?? "./drizzle";
	if (!fs.existsSync(folder)) {
		console.error(`[idempotize] ${folder} does not exist`);
		process.exit(1);
	}
	const files = fs
		.readdirSync(folder)
		.filter((name) => name.endsWith(".sql"))
		.map((name) => path.join(folder, name))
		.sort();
	let changed = 0;
	for (const file of files) {
		if (rewriteFile(file)) {
			console.log(`[idempotize] Rewrote ${file}`);
			changed += 1;
		}
	}
	console.log(`[idempotize] ${changed}/${files.length} file(s) updated`);
}

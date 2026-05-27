#!/usr/bin/env node
// Drizzle schema backward-compat check, run on every PR against main.
//
// What "backward compatible" means here: a Cloud Run revision built from
// `main` must keep running after the database has been migrated to the PR's
// schema. The new container migrates on boot (scripts/migrate.mjs) and only
// starts serving once migrations succeed — so during a rollout the old
// revision keeps taking traffic against the freshly-migrated DB. Removing
// or renaming a table/column is therefore a hard break; the old code
// running against the new DB will hit "column does not exist" errors at
// query time.
//
// Allowed: additive changes (new tables, new columns), wider types, new
// defaults. Flagged: dropped tables, dropped columns, renamed columns
// (which look like drop + add to this checker), and changed column types
// (warning, since some narrowings are safe but most aren't).
//
// The parser is regex-based on purpose — Drizzle schemas in this repo
// follow a predictable shape (`pgTable("name", { col: type("sql_name", ...) })`)
// and pulling in a TS parser to inspect a single file would dwarf the
// value. The exposed `parseSchema` is unit-tested.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = "src/db/schema.ts";

// --- Parser ----------------------------------------------------------------

// Extract every `pgTable("<sql_name>", { ... })` block from a TS source and
// pull out its columns. Returns Map<tableSqlName, Map<columnSqlName, type>>.
//
// Caveats:
//   - We rely on the SQL name being the first string argument to the column
//     helper (e.g. `text("name")`). That's how Drizzle queries spell columns
//     under the hood, so it's exactly what runtime compat hinges on.
//   - Comments and string literals inside the table body could theoretically
//     contain `pgTable(...)` text and fool us; the project doesn't do that
//     today. A failure mode here is a false positive, not a missed break.
export function parseSchema(src) {
	const tables = new Map();
	// Find every `pgTable("name", {` call by scanning the source with
	// comment/string awareness, then slice the *original* source for column
	// parsing (so we keep the string-literal column names intact).
	const calls = findPgTableCalls(src);
	for (const call of calls) {
		const bodyEnd = findMatchingBrace(src, call.bodyStart);
		if (bodyEnd === -1) continue;
		const body = src.slice(call.bodyStart + 1, bodyEnd);
		tables.set(call.tableName, parseColumns(body));
	}
	return tables;
}

// Scan src once, tracking whether we're inside a string or comment, and
// emit { tableName, bodyStart } for each top-level `pgTable("name", {`.
// `bodyStart` points at the opening `{`. Inside strings + comments any
// `pgTable(...)` text is ignored.
function findPgTableCalls(src) {
	const calls = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		// Line comment.
		if (c === "/" && src[i + 1] === "/") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		// Block comment.
		if (c === "/" && src[i + 1] === "*") {
			i += 2;
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		// String / template literal — skip to its close.
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(src, i);
			continue;
		}
		// Match `pgTable("name",\s*{` — the brace position becomes bodyStart.
		if (
			c === "p" &&
			src.startsWith("pgTable", i) &&
			!isIdentChar(src[i - 1])
		) {
			const after = i + "pgTable".length;
			const open = skipWhitespace(src, after);
			if (src[open] === "(") {
				const argStart = skipWhitespace(src, open + 1);
				if (src[argStart] === '"') {
					const argEnd = skipString(src, argStart);
					const tableName = src.slice(argStart + 1, argEnd - 1);
					let j = skipWhitespace(src, argEnd);
					if (src[j] === ",") {
						j = skipWhitespace(src, j + 1);
						if (src[j] === "{") {
							calls.push({ tableName, bodyStart: j });
							i = j + 1;
							continue;
						}
					}
				}
			}
		}
		i++;
	}
	return calls;
}

function isIdentChar(c) {
	return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

function skipWhitespace(src, i) {
	while (i < src.length && /\s/.test(src[i])) i++;
	return i;
}

function findMatchingBrace(src, openIdx) {
	let depth = 0;
	let i = openIdx;
	while (i < src.length) {
		const c = src[i];
		if (c === '"' || c === "'" || c === "`") {
			// Skip the matching string literal.
			i = skipString(src, i);
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			// Line comment.
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			i += 2;
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return -1;
}

function skipString(src, openIdx) {
	const quote = src[openIdx];
	let i = openIdx + 1;
	while (i < src.length) {
		const c = src[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === quote) return i + 1;
		// Template literals can carry `${...}` expressions, but Drizzle column
		// names never use them; treat templates like simple strings.
		i++;
	}
	return src.length;
}

// Walks the body of `pgTable("X", { ... })` and pulls `<jsKey>: <type>("<sqlName>", ...)`
// out of it. Skip lines that don't match — index() / uniqueIndex() definitions
// live in a separate trailing-array callback, not the columns object.
function parseColumns(body) {
	const cols = new Map();
	// Match `<key>: <typeHelper>("<sqlName>"`. The `[\s,{]` lookbehind makes
	// sure we only catch top-of-entry positions and don't pick up things
	// like `.references(() => user.id)` mid-chain.
	const re =
		/(?:^|[\s,{])([a-zA-Z_$][\w$]*)\s*:\s*([a-zA-Z_$][\w$]*)\s*\(\s*"([^"]+)"/g;
	let m;
	while ((m = re.exec(body)) !== null) {
		const sqlName = m[3];
		const type = m[2];
		// First entry wins — if a key were redefined (it can't in JS, just a
		// guardrail) we keep the original.
		if (!cols.has(sqlName)) cols.set(sqlName, type);
	}
	return cols;
}

// --- Diff ------------------------------------------------------------------

export function diffSchemas(prev, next) {
	const issues = [];
	for (const [table, prevCols] of prev) {
		const nextCols = next.get(table);
		if (!nextCols) {
			issues.push({
				kind: "table-removed",
				table,
				message: `Table "${table}" was removed. Old running code that queries it will break.`,
			});
			continue;
		}
		for (const [col, prevType] of prevCols) {
			const nextType = nextCols.get(col);
			if (nextType === undefined) {
				issues.push({
					kind: "column-removed",
					table,
					column: col,
					message: `Column "${table}.${col}" was removed. If you're renaming, deploy in two steps: add the new column → cut over readers/writers → drop the old.`,
				});
				continue;
			}
			if (nextType !== prevType) {
				issues.push({
					kind: "column-type-changed",
					table,
					column: col,
					message: `Column "${table}.${col}" type changed: ${prevType} → ${nextType}. Verify old code can read the new type.`,
				});
			}
		}
	}
	return issues;
}

// --- Runner ----------------------------------------------------------------

function readMainSchema(baseRef) {
	try {
		// `--` separates pathspec from ref. `--no-pager` keeps git from piping
		// through a pager (which would block in CI).
		return execFileSync(
			"git",
			["--no-pager", "show", `${baseRef}:${SCHEMA_PATH}`],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (err) {
		// First commit, file didn't exist on main, or main isn't fetched —
		// not a break, just nothing to check against.
		console.warn(
			`[db-back-compat] could not read ${baseRef}:${SCHEMA_PATH} — skipping check.`,
		);
		console.warn(`  ${err.message?.trim?.() ?? err}`);
		return null;
	}
}

function main() {
	const baseRef = process.env.BASE_REF || "origin/main";
	const prevSrc = readMainSchema(baseRef);
	if (prevSrc === null) {
		process.exit(0);
	}
	const nextSrc = readFileSync(SCHEMA_PATH, "utf8");

	const prev = parseSchema(prevSrc);
	const next = parseSchema(nextSrc);
	const issues = diffSchemas(prev, next);

	if (issues.length === 0) {
		console.log(
			`[db-back-compat] OK — no removed tables / columns vs ${baseRef}.`,
		);
		process.exit(0);
	}

	const breaking = issues.filter(
		(i) => i.kind === "table-removed" || i.kind === "column-removed",
	);
	const warnings = issues.filter((i) => i.kind === "column-type-changed");

	for (const issue of breaking) {
		console.error(`✖ [BREAKING] ${issue.message}`);
	}
	for (const issue of warnings) {
		console.warn(`⚠ ${issue.message}`);
	}

	if (breaking.length > 0) {
		console.error(
			`\nFound ${breaking.length} breaking schema change(s) vs ${baseRef}.`,
		);
		console.error(
			"If this is intentional, deploy in two steps: roll out the additive",
		);
		console.error(
			"change first (compatible with both old + new code), then a second",
		);
		console.error("PR that drops the old column once nothing reads it.");
		process.exit(1);
	}
	process.exit(0);
}

// Run only when invoked as a script — keeps the parser importable for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

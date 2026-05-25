#!/usr/bin/env node
// Verifies the production client bundle (.output/public/) does not contain
// any secret values from .env / .env.local, nor any server-only file path
// fragments that should have been tree-shaken out.
//
// Run as: `pnpm secrets:check` (rebuilds first) or `node scripts/check-secret-leak.mjs`.
// Exits non-zero on any finding so it can gate CI.
//
// What's a "secret"? Anything in .env / .env.local that is NOT prefixed
// with `VITE_` — those are explicitly opted-into the client bundle by
// Vite. The check ignores empty values (placeholder lines like
// `BETTER_AUTH_SECRET=` would otherwise match every byte of every file).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const BUNDLE_DIR = join(ROOT, ".output/public");

// Tiny `.env`-style parser so we don't pull in dotenv here. Handles
// `KEY=value` with optional surrounding quotes and trailing `# comments`.
function parseEnvFile(path) {
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	const out = {};
	for (const line of raw.split("\n")) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (!m) continue;
		let value = m[2];
		// Strip surrounding single or double quotes.
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else {
			// Drop trailing `# comment` only when the value wasn't quoted.
			const hash = value.indexOf("#");
			if (hash >= 0) value = value.slice(0, hash).trim();
		}
		if (value) out[m[1]] = value;
	}
	return out;
}

const env = {
	...parseEnvFile(join(ROOT, ".env")),
	...parseEnvFile(join(ROOT, ".env.local")),
};

// VITE_* and PUBLIC_* keys are intentionally exposed — skip them.
// Short values get noisy false positives (e.g. NODE_ENV=production).
const MIN_SECRET_LENGTH = 12;
const secretValues = Object.entries(env)
	.filter(([k]) => !k.startsWith("VITE_") && !k.startsWith("PUBLIC_"))
	.filter(([, v]) => v.length >= MIN_SECRET_LENGTH)
	.map(([k, v]) => ({ name: k, value: v }));

// Server-only module markers. If any of these strings appear inside a
// client chunk, server code was dragged into the client graph.
const SERVER_MARKERS = [
	"chat.server",
	"auth.server",
	"automerge-server",
	"automerge-pg-storage",
	"workspace-store.server",
	"auth-context.server",
];

function walk(dir, files = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, files);
		else files.push(p);
	}
	return files;
}

let bundleFiles;
try {
	bundleFiles = walk(BUNDLE_DIR);
} catch (err) {
	console.error(
		`[secrets:check] ${BUNDLE_DIR} not found — run \`pnpm build\` first.`,
	);
	console.error(err.message);
	process.exit(2);
}

const findings = [];

for (const file of bundleFiles) {
	let body;
	try {
		body = readFileSync(file, "utf8");
	} catch {
		// Binary file (wasm, images) — skip.
		continue;
	}
	for (const secret of secretValues) {
		if (body.includes(secret.value)) {
			findings.push({
				severity: "leak",
				file: relative(ROOT, file),
				detail: `contains literal value of ${secret.name} (${secret.value.length} chars)`,
			});
		}
	}
	for (const marker of SERVER_MARKERS) {
		if (body.includes(marker)) {
			findings.push({
				severity: "server-code",
				file: relative(ROOT, file),
				detail: `references server-only module \`${marker}\``,
			});
		}
	}
}

console.log(
	`[secrets:check] scanned ${bundleFiles.length} files in .output/public against ${secretValues.length} secrets`,
);
console.log(
	`  ${secretValues.map((s) => `${s.name}(${s.value.length}c)`).join(", ") || "(none — set DATABASE_URL etc. in .env.local to enable the check)"}`,
);

if (findings.length === 0) {
	console.log("[secrets:check] ✓ clean — no secret values or server-only modules in the client bundle.");
	process.exit(0);
}

console.error("\n[secrets:check] ✗ findings:");
for (const f of findings) {
	console.error(`  [${f.severity}] ${f.file} — ${f.detail}`);
}
process.exit(1);

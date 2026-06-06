// Post-build service-worker generation for the PWA.
//
// Why a standalone step instead of vite-plugin-pwa: this app builds through
// TanStack Start + Nitro, which relocate the client assets into
// `.output/public` AFTER Vite's client build closes. vite-plugin-pwa's Workbox
// hook runs against Vite's outDir before that move, so it precaches nothing
// here. Running workbox-build directly against the final public dir sidesteps
// the lifecycle mismatch entirely (and avoids pulling workbox-window through
// the Rolldown client bundle).
//
// Run via `pnpm build:pwa` (which sets VITE_PWA_ENABLED=1 so the client
// actually registers /sw.js — see src/lib/pwa/register-sw.ts).
//
// Offline model (SSR app, no static HTML shell to precache):
//  - All hashed JS/CSS/font/icon assets are precached → they load offline.
//  - Navigation documents are NetworkFirst-cached → a route visited online
//    boots offline on reload, after which TanStack Router does client-side
//    navigation (data comes from the offline-first query cache + local
//    Automerge docs). A never-visited route can't load on a cold offline
//    start — inherent to SSR without a prerendered shell.
//  - /api/** (Better Auth) and /sync (Automerge WS upgrade) are NetworkOnly so
//    auth/sync are never served from cache.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { generateSW } from "workbox-build";
import { assetEtag, assetType, injectAssets } from "./nitro-sw-manifest.mjs";

const PUBLIC_DIR = process.env.PWA_PUBLIC_DIR || ".output/public";
// Nitro bakes a static public-assets manifest into the server entry; it serves
// ONLY the files listed there (the runtime reads each from disk, but unlisted
// paths 404). Because this script runs after Nitro's build closes, the SW files
// it emits are on disk but absent from that manifest — so /sw.js 404s in
// production until we register them here. See registerSwInNitroManifest below.
const SERVER_DIR = process.env.PWA_SERVER_DIR || ".output/server";

const { count, size, warnings, filePaths } = await generateSW({
	globDirectory: PUBLIC_DIR,
	globPatterns: ["**/*.{js,css,svg,ico,png,woff2,json,txt}"],
	swDest: `${PUBLIC_DIR}/sw.js`,
	cleanupOutdatedCaches: true,
	clientsClaim: true,
	skipWaiting: true,
	// Largest client chunk (p._projectId) is ~1.9 MB; give headroom so it's
	// precached rather than silently skipped.
	maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
	runtimeCaching: [
		{
			// Never cache auth or sync traffic.
			urlPattern: /\/(api\/|sync)(\b|\/|$)/,
			handler: "NetworkOnly",
		},
		{
			// Navigation documents (extension-less GET paths that aren't api/sync/
			// asset/sw). NetworkFirst so a freshly-deployed HTML wins online, and
			// the last-seen copy boots the SPA offline.
			urlPattern:
				/^https?:\/\/[^/]+\/(?!api\/|sync\b|assets\/|sw\.js$|workbox-|favicon|robots|manifest)[^.]*$/,
			handler: "NetworkFirst",
			options: {
				cacheName: "pages",
				networkTimeoutSeconds: 3,
				expiration: { maxEntries: 50 },
			},
		},
	],
});

for (const w of warnings) console.warn("[generate-sw]", w);
console.log(
	`[generate-sw] precached ${count} files (${(size / 1024).toFixed(1)} KiB) → ${filePaths.join(", ")}`,
);

registerSwInNitroManifest(filePaths);

// Register the just-emitted SW files (sw.js, workbox-*.js, their .map sidecars)
// in Nitro's baked public-assets manifest so the server actually serves them —
// see scripts/nitro-sw-manifest.mjs for why this is necessary and the exact
// entry shape. Reads the real bytes for each file (size/etag) and writes the
// patched server entry back.
function registerSwInNitroManifest(emitted) {
	const entryFile = findManifestFile();
	const publicRoot = resolve(PUBLIC_DIR);
	// "../public" relative to the server entry, matching Nitro's own path form.
	const toServer = relative(SERVER_DIR, publicRoot).split(/[/\\]/).join("/");

	const entries = [];
	for (const fp of emitted) {
		const abs = resolve(fp);
		const rel = relative(publicRoot, abs).split(/[/\\]/).join("/");
		if (rel.startsWith("..")) continue; // outside the public dir — skip
		const bytes = readFileSync(abs);
		entries.push({
			key: `/${rel}`,
			type: assetType(rel),
			etag: assetEtag(bytes),
			mtime: statSync(abs).mtime.toISOString(),
			size: bytes.length,
			path: posix.join(toServer, rel),
		});
	}

	const { source, added } = injectAssets(readFileSync(entryFile, "utf8"), entries);
	if (added.length === 0) {
		console.log("[generate-sw] no new SW assets to register in Nitro manifest");
		return;
	}
	writeFileSync(entryFile, source);
	console.log(
		`[generate-sw] registered ${added.length} SW asset(s) in Nitro manifest (${entryFile}): ${added.join(", ")}`,
	);
}

// The manifest lives in the Nitro server entry — index.mjs in current builds.
// Probe it first, then fall back to scanning the server dir's top-level .mjs
// files so a rename doesn't silently defeat the patch.
function findManifestFile() {
	const probe = join(SERVER_DIR, "index.mjs");
	const candidates = [];
	try {
		if (readFileSync(probe, "utf8").includes("public_assets_data_default")) {
			return probe;
		}
	} catch {
		// fall through to the directory scan
	}
	for (const name of readdirSync(SERVER_DIR)) {
		if (!name.endsWith(".mjs")) continue;
		const full = join(SERVER_DIR, name);
		try {
			if (readFileSync(full, "utf8").includes("public_assets_data_default")) {
				candidates.push(full);
			}
		} catch {
			// unreadable entry — ignore
		}
	}
	if (candidates.length === 0) {
		throw new Error(
			`[generate-sw] no Nitro server entry under ${SERVER_DIR} contains the ` +
				"public-assets manifest. Run this after `vite build` (the `build:pwa` order).",
		);
	}
	return candidates[0];
}

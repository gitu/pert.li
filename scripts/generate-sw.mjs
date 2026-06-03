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

import { generateSW } from "workbox-build";

const PUBLIC_DIR = process.env.PWA_PUBLIC_DIR || ".output/public";

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

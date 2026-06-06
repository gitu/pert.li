// Pure helpers for registering post-build service-worker assets into Nitro's
// baked public-assets manifest. Kept side-effect-free (no fs, no globals) so
// they're unit-testable; the file I/O lives in scripts/generate-sw.mjs.
//
// Background: Nitro emits a `public_assets_data_default` object literal into its
// server entry listing every public file (type/etag/mtime/size/path). The
// runtime serves ONLY paths present in that map — a request for an unlisted
// file falls through to the SSR catch-all and 404s. Files written after the
// Nitro build closes (the workbox SW + sidecars) therefore need to be injected
// here so the server actually serves them.

import { createHash } from "node:crypto";

const MIME = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
};

// Locates the manifest object literal in a server-entry source string.
const MANIFEST_MARKER = /public_assets_data_default\s*=\s*\{/;

/** Content-type for a public asset, matching the strings Nitro emits. */
export function assetType(name) {
	const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
	return MIME[ext] ?? "application/octet-stream";
}

/**
 * Nitro's weak-ish strong etag: `"<sizeHex>-<base64(sha1(bytes)) w/o padding>"`.
 * Verified byte-for-byte against the etag Nitro bakes for its own assets, so a
 * conditional request with this value returns 304 from the built server.
 */
export function assetEtag(bytes) {
	const hash = createHash("sha1").update(bytes).digest("base64").replace(/=+$/, "");
	return `"${bytes.length.toString(16)}-${hash}"`;
}

/**
 * Inject asset entries into a Nitro public-assets manifest source string.
 *
 * @param {string} source  The server-entry source containing the manifest.
 * @param {Array<{key:string,type:string,etag:string,mtime:string,size:number,path:string}>} entries
 * @returns {{ source: string, added: string[] }} patched source + injected keys.
 *          Entries whose key is already present are skipped (idempotent).
 * @throws if the manifest marker can't be found — surfaces a Nitro output-shape
 *         change at build time instead of silently shipping a 404-ing SW.
 */
export function injectAssets(source, entries) {
	const marker = source.match(MANIFEST_MARKER);
	if (!marker) {
		throw new Error(
			"Nitro public-assets manifest (public_assets_data_default) not found — " +
				"its output shape likely changed; the SW serving patch needs updating.",
		);
	}
	let injected = "";
	const added = [];
	for (const e of entries) {
		if (source.includes(`"${e.key}":`)) continue;
		const lines = [
			["type", e.type],
			["etag", e.etag],
			["mtime", e.mtime],
			["size", e.size],
			["path", e.path],
		].map(([k, v]) => `\t\t${JSON.stringify(k)}: ${JSON.stringify(v)}`);
		injected += `\t${JSON.stringify(e.key)}: {\n${lines.join(",\n")}\n\t},\n`;
		added.push(e.key);
	}
	if (!injected) return { source, added };
	const at = marker.index + marker[0].length;
	return { source: `${source.slice(0, at)}\n${injected}${source.slice(at)}`, added };
}

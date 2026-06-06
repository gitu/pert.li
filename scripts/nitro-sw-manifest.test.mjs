import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assetEtag, assetType, injectAssets } from "./nitro-sw-manifest.mjs";

// A minimal stand-in for Nitro's baked server entry: the manifest object
// literal with one pre-existing entry, wrapped in surrounding code so we can
// assert the rest of the file is preserved.
const MANIFEST_SOURCE = [
	"// nitro server entry (excerpt)",
	"var public_assets_data_default = {",
	'\t"/robots.txt": {',
	'\t\t"type": "text/plain; charset=utf-8",',
	'\t\t"etag": "\\"43-BEzmj4PuhUNHX+oW9uOnPSihxtU\\"",',
	'\t\t"mtime": "2026-06-06T14:39:42.871Z",',
	'\t\t"size": 67,',
	'\t\t"path": "../public/robots.txt"',
	"\t}",
	"};",
	"function getAsset(id) { return public_assets_data_default[id]; }",
].join("\n");

const swEntry = {
	key: "/sw.js",
	type: "text/javascript; charset=utf-8",
	etag: '"1d3a-QSbOEvRjB7aBAj90ZyTQSGspZRI"',
	mtime: "2026-06-06T19:42:56.506Z",
	size: 7482,
	path: "../public/sw.js",
};

describe("assetType", () => {
	it("maps known extensions to the exact strings Nitro emits", () => {
		expect(assetType("sw.js")).toBe("text/javascript; charset=utf-8");
		expect(assetType("sw.js.map")).toBe("application/json; charset=utf-8");
		expect(assetType("styles.css")).toBe("text/css; charset=utf-8");
		expect(assetType("favicon.svg")).toBe("image/svg+xml");
	});

	it("falls back to octet-stream for unknown extensions", () => {
		expect(assetType("mystery.bin")).toBe("application/octet-stream");
	});
});

describe("assetEtag", () => {
	it("matches Nitro's format: \"<sizeHex>-<base64(sha1) without padding>\"", () => {
		const bytes = Buffer.from("User-agent: *\nAllow: /\n");
		const expectedHash = createHash("sha1")
			.update(bytes)
			.digest("base64")
			.replace(/=+$/, "");
		expect(assetEtag(bytes)).toBe(`"${bytes.length.toString(16)}-${expectedHash}"`);
	});

	it("encodes the size as hex (the byte length, not decimal)", () => {
		const bytes = Buffer.alloc(255); // 255 -> 0xff
		expect(assetEtag(bytes).startsWith('"ff-')).toBe(true);
	});
});

describe("injectAssets", () => {
	it("inserts a new entry right after the manifest opening brace", () => {
		const { source, added } = injectAssets(MANIFEST_SOURCE, [swEntry]);
		expect(added).toEqual(["/sw.js"]);
		expect(source).toContain('"/sw.js": {');
		// new key precedes the pre-existing one, and the file's tail survives.
		expect(source.indexOf('"/sw.js":')).toBeLessThan(source.indexOf('"/robots.txt":'));
		expect(source).toContain("function getAsset(id)");
	});

	it("emits fields in Nitro's order with its quoting (etag value is a quoted string)", () => {
		const { source } = injectAssets(MANIFEST_SOURCE, [swEntry]);
		const block = source.slice(source.indexOf('"/sw.js":'));
		const order = ["type", "etag", "mtime", "size", "path"].map((k) =>
			block.indexOf(`"${k}":`),
		);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(block).toContain('"etag": "\\"1d3a-QSbOEvRjB7aBAj90ZyTQSGspZRI\\""');
		expect(block).toContain('"path": "../public/sw.js"');
	});

	it("stays valid JS so the patched server entry still parses", () => {
		const { source } = injectAssets(MANIFEST_SOURCE, [swEntry]);
		// `new Function` throws on a syntax error — proves the injection didn't
		// corrupt the surrounding object literal.
		expect(() => new Function(source)).not.toThrow();
	});

	it("is idempotent: skips keys already present in the manifest", () => {
		const once = injectAssets(MANIFEST_SOURCE, [swEntry]).source;
		const twice = injectAssets(once, [swEntry]);
		expect(twice.added).toEqual([]);
		expect(twice.source).toBe(once);
		// exactly one occurrence of the key
		expect(twice.source.split('"/sw.js":').length - 1).toBe(1);
	});

	it("injects multiple entries in the given order", () => {
		const map = { ...swEntry, key: "/sw.js.map", path: "../public/sw.js.map" };
		const { source, added } = injectAssets(MANIFEST_SOURCE, [swEntry, map]);
		expect(added).toEqual(["/sw.js", "/sw.js.map"]);
		expect(source.indexOf('"/sw.js":')).toBeLessThan(source.indexOf('"/sw.js.map":'));
	});

	it("throws when the manifest marker is absent (Nitro output shape changed)", () => {
		expect(() => injectAssets("var something_else = {};", [swEntry])).toThrow(
			/public_assets_data_default/,
		);
	});
});

import { describe, expect, it } from "vitest";
import { BUILD_TIME, BUILD_VERSION } from "#/lib/build-info";

describe("build-info", () => {
	it("exposes a non-empty version string", () => {
		expect(typeof BUILD_VERSION).toBe("string");
		expect(BUILD_VERSION.length).toBeGreaterThan(0);
	});

	it("exposes a build time that is null or a parseable ISO timestamp", () => {
		if (BUILD_TIME === null) return;
		expect(typeof BUILD_TIME).toBe("string");
		expect(Number.isNaN(Date.parse(BUILD_TIME))).toBe(false);
	});
});

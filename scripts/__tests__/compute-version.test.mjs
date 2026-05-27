import { describe, expect, it } from "vitest";
import { getAppVersion } from "../compute-version.mjs";

describe("getAppVersion", () => {
	it("prefers APP_VERSION env over git describe", () => {
		const version = getAppVersion({
			env: { APP_VERSION: "v1.2.3-injected" },
			exec: () => "v0.0.0-fallback",
		});
		expect(version).toBe("v1.2.3-injected");
	});

	it("trims surrounding whitespace from the env var", () => {
		const version = getAppVersion({
			env: { APP_VERSION: "  v1.2.3  \n" },
			exec: () => null,
		});
		expect(version).toBe("v1.2.3");
	});

	it("treats an empty APP_VERSION as unset", () => {
		const version = getAppVersion({
			env: { APP_VERSION: "" },
			exec: () => "v0.3.2-4-gabc1234",
		});
		expect(version).toBe("v0.3.2-4-gabc1234");
	});

	it("falls back to git describe when env is missing", () => {
		const version = getAppVersion({
			env: {},
			exec: () => "v0.3.2-4-gabc1234-dirty",
		});
		expect(version).toBe("v0.3.2-4-gabc1234-dirty");
	});

	it("falls back to 0.0.0-dev when env and git both unavailable", () => {
		const version = getAppVersion({
			env: {},
			exec: () => null,
		});
		expect(version).toBe("0.0.0-dev");
	});
});

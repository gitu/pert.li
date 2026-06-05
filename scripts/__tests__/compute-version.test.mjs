import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultExec, getAppVersion } from "../compute-version.mjs";

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

// Pins the "clean on an actual tag" contract against a real throwaway repo, so
// the chosen `git describe` flags can't silently regress (e.g. a stray
// `--long` would turn an exact tag into `v9.9.9-0-gabc1234`).
describe("defaultExec (real git repo)", () => {
	let dir;
	const git = (...args) =>
		execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "compute-version-"));
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");
		writeFileSync(join(dir, "a.txt"), "one\n");
		git("add", "-A");
		git("commit", "-q", "-m", "first");
		git("tag", "v9.9.9");
	});

	afterAll(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("returns the bare tag when HEAD is exactly on a tag (clean tree)", () => {
		expect(defaultExec(dir)).toBe("v9.9.9");
	});

	it("keeps the -dirty marker on a tagged but dirty working tree", () => {
		writeFileSync(join(dir, "a.txt"), "changed\n");
		expect(defaultExec(dir)).toBe("v9.9.9-dirty");
		// restore for the next case
		execFileSync("git", ["checkout", "--", "a.txt"], {
			cwd: dir,
			stdio: "ignore",
		});
	});

	it("adds the -N-gHASH suffix for commits past a tag", () => {
		writeFileSync(join(dir, "b.txt"), "two\n");
		git("add", "-A");
		git("commit", "-q", "-m", "second");
		expect(defaultExec(dir)).toMatch(/^v9\.9\.9-1-g[0-9a-f]+$/);
	});
});

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// End-to-end smoke test for `scripts/publish-pr-screenshots.sh`. We run
// the real script against a local bare repo (acting as the GitHub
// remote) to prove two things that broke in production at least once:
//
//   1. A *relative* source dir argument (the workflow passes
//      `pr-staging`) is still resolved correctly after the script
//      `cd`s into its work directory. The previous version of the
//      script kept the arg as-is and `cp` errored with
//      "cannot stat 'pr-staging/.': No such file or directory".
//   2. The branch-bootstrap path runs only when the screenshots branch
//      truly does not exist on the remote — not on every transient
//      `git fetch` failure (the old `2>/dev/null` swallowed real
//      errors).

const SCRIPT = path.resolve("scripts/publish-pr-screenshots.sh");

function rewriteRemote(scriptPath, fakeRemoteUrl) {
	// The shipped script hard-codes the GitHub HTTPS URL; the test
	// reroutes it to a local `file://` bare repo so we never touch the
	// real network.
	const original = execFileSync("cat", [SCRIPT], { encoding: "utf8" });
	const patched = original.replace(
		/https:\/\/x-access-token:.*@github\.com\/.*\.git/,
		fakeRemoteUrl,
	);
	writeFileSync(scriptPath, patched, { mode: 0o755 });
}

function run(scriptPath, srcDirArg, cwd, env) {
	return execFileSync("bash", [scriptPath, srcDirArg], {
		cwd,
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
}

function lsTree(repoPath, ref) {
	return execSync(`git -C ${JSON.stringify(repoPath)} ls-tree -r ${ref}`, {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("\t")[1]);
}

describe("publish-pr-screenshots.sh", () => {
	let tmp;
	let remote;
	let workdir;
	let patchedScript;
	const baseEnv = {
		PR_NUMBER: "42",
		HEAD_SHA: "abc1234567890def",
		GITHUB_TOKEN: "dummy",
		GITHUB_REPOSITORY: "fake/repo",
	};

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "publish-pr-test-"));
		remote = path.join(tmp, "remote.git");
		mkdirSync(remote);
		execSync(`git -C ${JSON.stringify(remote)} init --bare -q`);
		workdir = path.join(tmp, "workdir");
		mkdirSync(workdir);
		patchedScript = path.join(tmp, "publish.sh");
		rewriteRemote(patchedScript, `file://${remote}`);
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("resolves a relative source dir and bootstraps the screenshots branch on first run", () => {
		const src = path.join(workdir, "pr-staging");
		mkdirSync(src);
		writeFileSync(path.join(src, "story-a.png"), "fake png a");
		writeFileSync(path.join(src, "story-b.png"), "fake png b");

		const out = run(patchedScript, "pr-staging", workdir, baseEnv);
		expect(out).toContain("bootstrapping");
		expect(out).toContain("pushed pr-42/ to screenshots");

		expect(lsTree(remote, "screenshots")).toEqual([
			"README.md",
			"pr-42/story-a.png",
			"pr-42/story-b.png",
		]);
	});

	it("replaces the PR directory wholesale on a subsequent push to the same PR", () => {
		const src = path.join(workdir, "pr-staging");
		mkdirSync(src);
		writeFileSync(path.join(src, "old.png"), "fake old");
		run(patchedScript, "pr-staging", workdir, baseEnv);

		// Second run: a completely different file set under pr-staging.
		// pr-42/ on the screenshots branch should end up reflecting the
		// new set with the old file gone.
		rmSync(path.join(src, "old.png"));
		writeFileSync(path.join(src, "new.png"), "fake new");
		writeFileSync(path.join(src, "another.png"), "another");
		const out = run(patchedScript, "pr-staging", workdir, {
			...baseEnv,
			HEAD_SHA: "deadbeef000",
		});
		expect(out).toContain("pushed pr-42/ to screenshots");
		// The bootstrap line MUST NOT appear on the second run — the
		// branch already exists, and the previous swallow-error fetch
		// could clobber it by routing through bootstrap on a flake.
		expect(out).not.toContain("bootstrapping");

		const tree = lsTree(remote, "screenshots");
		expect(tree).toContain("pr-42/new.png");
		expect(tree).toContain("pr-42/another.png");
		expect(tree).not.toContain("pr-42/old.png");
	});
});

import { execFileSync, execSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// End-to-end smoke test for `scripts/publish-pr-screenshots.sh`. The script
// runs inside a PR-head checkout, stages the committed `screenshots/`
// baseline dir, and — only when a baseline actually changed — commits the
// result and pushes it to the PR head branch. We exercise the real script
// against a local bare repo acting as `origin` to prove:
//
//   1. A changed baseline produces exactly one commit, pushed to HEAD_REF,
//      with the commit SHA and a `screenshot_changed=true` flag emitted to
//      $GITHUB_OUTPUT and the staged name-status written to $NAME_STATUS_OUT.
//   2. An unchanged render is a clean no-op: no commit, no push, and
//      `screenshot_changed=false`.

const SCRIPT = path.resolve("scripts/publish-pr-screenshots.sh");

function git(repo, args) {
	return execSync(`git -C ${JSON.stringify(repo)} ${args}`, {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
}

function run(cwd, env) {
	return execFileSync("bash", [SCRIPT], {
		cwd,
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
}

describe("publish-pr-screenshots.sh", () => {
	let tmp;
	let remote;
	let checkout;
	let outputFile;
	let nameStatusFile;
	const branch = "feature";

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "publish-pr-test-"));
		remote = path.join(tmp, "remote.git");
		mkdirSync(remote);
		git(remote, "init --bare -q");

		// Seed a PR-head checkout: a `feature` branch carrying an existing
		// screenshot baseline, already pushed to the bare `origin`.
		checkout = path.join(tmp, "checkout");
		execSync(`git clone -q ${JSON.stringify(remote)} ${JSON.stringify(checkout)}`);
		git(checkout, "checkout -q -b feature");
		mkdirSync(path.join(checkout, "screenshots"));
		writeFileSync(path.join(checkout, "screenshots", "foo--default.png"), "baseline-v1");
		git(checkout, "add screenshots");
		git(checkout, 'commit -q -m "seed baselines"');
		git(checkout, "push -q origin feature");

		outputFile = path.join(tmp, "gh-output");
		writeFileSync(outputFile, "");
		nameStatusFile = path.join(tmp, "name-status.txt");
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	const baseEnv = () => ({
		HEAD_REF: branch,
		PR_NUMBER: "42",
		GITHUB_OUTPUT: outputFile,
		NAME_STATUS_OUT: nameStatusFile,
	});

	it("commits and pushes a changed baseline to the PR branch and emits the SHA", () => {
		// New render: one modified PNG + one brand-new story.
		writeFileSync(path.join(checkout, "screenshots", "foo--default.png"), "baseline-v2");
		writeFileSync(path.join(checkout, "screenshots", "foo--new.png"), "fresh");

		const out = run(checkout, baseEnv());
		expect(out).toContain("pushed screenshot baselines to feature");

		// A single new commit landed on the bare remote's branch.
		const remoteSha = git(remote, "rev-parse feature").trim();
		const localSha = git(checkout, "rev-parse HEAD").trim();
		expect(remoteSha).toBe(localSha);

		const output = readFileSync(outputFile, "utf8");
		expect(output).toContain("screenshot_changed=true");
		expect(output).toMatch(new RegExp(`screenshot_sha=${localSha}`));

		// Name-status captured for the comment builder.
		const nameStatus = readFileSync(nameStatusFile, "utf8");
		expect(nameStatus).toMatch(/M\s+screenshots\/foo--default\.png/);
		expect(nameStatus).toMatch(/A\s+screenshots\/foo--new\.png/);

		// The pushed tree carries both PNGs.
		const tree = git(remote, "ls-tree -r --name-only feature")
			.split("\n")
			.filter(Boolean);
		expect(tree).toContain("screenshots/foo--default.png");
		expect(tree).toContain("screenshots/foo--new.png");
	});

	it("is a clean no-op when the render matches the committed baseline", () => {
		const before = git(checkout, "rev-parse HEAD").trim();
		const remoteBefore = git(remote, "rev-parse feature").trim();

		const out = run(checkout, baseEnv());
		expect(out).toContain("no screenshot baseline changes");

		// No new commit locally or on the remote.
		expect(git(checkout, "rev-parse HEAD").trim()).toBe(before);
		expect(git(remote, "rev-parse feature").trim()).toBe(remoteBefore);

		expect(readFileSync(outputFile, "utf8")).toContain("screenshot_changed=false");
	});

	it("stages a removed baseline as a deletion", () => {
		rmSync(path.join(checkout, "screenshots", "foo--default.png"));
		writeFileSync(path.join(checkout, "screenshots", "foo--replacement.png"), "new");

		run(checkout, baseEnv());

		const nameStatus = readFileSync(nameStatusFile, "utf8");
		expect(nameStatus).toMatch(/D\s+screenshots\/foo--default\.png/);
		const tree = git(remote, "ls-tree -r --name-only feature")
			.split("\n")
			.filter(Boolean);
		expect(tree).not.toContain("screenshots/foo--default.png");
		expect(tree).toContain("screenshots/foo--replacement.png");
	});
});

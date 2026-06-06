import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// End-to-end smoke test for `scripts/publish-baseline-screenshots.sh` against a
// local bare repo standing in for the GitHub remote. The novel behaviour worth
// pinning is the INCREMENTAL apply: only changed/new renders are written,
// removed stories are deleted, and a run with no deltas produces no commit —
// i.e. the baseline branch carries "only the changes".

const SCRIPT = path.resolve("scripts/publish-baseline-screenshots.sh");

function patchedScriptFor(scriptPath, fakeRemoteUrl) {
	const original = readFileSync(SCRIPT, { encoding: "utf8" });
	const patched = original.replace(
		/https:\/\/x-access-token:.*@github\.com\/.*\.git/,
		fakeRemoteUrl,
	);
	writeFileSync(scriptPath, patched, { mode: 0o755 });
}

function tree(repoPath) {
	return execSync(`git -C ${JSON.stringify(repoPath)} ls-tree -r --name-only screenshots`, {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);
}

function head(repoPath) {
	return execSync(`git -C ${JSON.stringify(repoPath)} rev-parse screenshots`, {
		encoding: "utf8",
	}).trim();
}

describe("publish-baseline-screenshots.sh", () => {
	let tmp;
	let remote;
	let workdir;
	let script;

	function run(changedStories, env) {
		writeFileSync(path.join(workdir, "changed.json"), JSON.stringify({ stories: changedStories }));
		return execFileSync("bash", [script, "changed.json", "render"], {
			cwd: workdir,
			env: { ...process.env, GITHUB_TOKEN: "x", GITHUB_REPOSITORY: "fake/repo", ...env },
			encoding: "utf8",
		});
	}

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "publish-baseline-"));
		remote = path.join(tmp, "remote.git");
		mkdirSync(remote);
		execSync(`git -C ${JSON.stringify(remote)} init --bare -q`);
		workdir = path.join(tmp, "workdir");
		mkdirSync(path.join(workdir, "render"), { recursive: true });
		script = path.join(tmp, "publish.sh");
		patchedScriptFor(script, `file://${remote}`);
	});

	afterEach(() => rmSync(tmp, { recursive: true, force: true }));

	it("bootstraps the branch and seeds changed/new stories", () => {
		writeFileSync(path.join(workdir, "render", "comp--a.png"), "a");
		writeFileSync(path.join(workdir, "render", "comp--b.png"), "b");
		const out = run(
			[
				{ id: "comp--a", status: "changed" },
				{ id: "comp--b", status: "new" },
			],
			{ HEAD_SHA: "aaaa111" },
		);
		expect(out).toContain("bootstrapping");
		expect(tree(remote)).toEqual(["README.md", "baseline/comp--a.png", "baseline/comp--b.png"]);
	});

	it("applies only the delta: updates changed, deletes removed, leaves the rest", () => {
		writeFileSync(path.join(workdir, "render", "comp--a.png"), "a");
		writeFileSync(path.join(workdir, "render", "comp--b.png"), "b");
		run(
			[
				{ id: "comp--a", status: "changed" },
				{ id: "comp--b", status: "new" },
			],
			{ HEAD_SHA: "aaaa111" },
		);

		// Second push: comp--a's content changes, comp--b is removed.
		writeFileSync(path.join(workdir, "render", "comp--a.png"), "a2");
		const out = run(
			[
				{ id: "comp--a", status: "changed" },
				{ id: "comp--b", status: "removed" },
			],
			{ HEAD_SHA: "bbbb222" },
		);
		expect(out).not.toContain("bootstrapping");
		expect(tree(remote)).toEqual(["README.md", "baseline/comp--a.png"]);
		expect(execSync(`git -C ${JSON.stringify(remote)} show screenshots:baseline/comp--a.png`, {
			encoding: "utf8",
		})).toBe("a2");
	});

	it("makes no commit when there are no deltas", () => {
		writeFileSync(path.join(workdir, "render", "comp--a.png"), "a");
		run([{ id: "comp--a", status: "new" }], { HEAD_SHA: "aaaa111" });
		const before = head(remote);
		const out = run([], { HEAD_SHA: "cccc333" });
		expect(out).toContain("no baseline changes to publish");
		expect(head(remote)).toBe(before);
	});
});

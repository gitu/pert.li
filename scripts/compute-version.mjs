#!/usr/bin/env node
// Resolves the human-readable build version surfaced to the running app
// (via `import.meta.env.VITE_APP_VERSION`) and to ops tooling.
//
// Precedence (first match wins):
//   1. APP_VERSION env var — CI injects `git describe --tags --always` so the
//      Docker build doesn't need .git inside the container.
//   2. `git describe --tags --always --dirty` against the working tree —
//      gives `v0.3.2`, `v0.3.2-4-gabc1234`, or `v0.3.2-4-gabc1234-dirty`
//      depending on tag/HEAD/working-tree state. When HEAD sits exactly on a
//      tag the version is the bare tag (`v0.3.2`) — no commit-count/hash
//      decoration — and only picks up a `-dirty` suffix if the working tree
//      has uncommitted changes. The `-N-gabc1234` form appears only for
//      commits *past* a tag.
//   3. Fallback `0.0.0-dev` — no git history (e.g. a tarball install) and
//      no env override.

import { execFileSync } from "node:child_process";

const FALLBACK = "0.0.0-dev";

// The exact `git describe` invocation that gives us the "clean on an actual
// tag" guarantee: `--tags` so lightweight release tags count, `--always` so a
// repo with no tags still yields the short hash, `--dirty` so an uncommitted
// working tree is flagged. Exported so tests can pin the flags against a real
// repo — changing them (e.g. adding `--long`) would break the bare-tag
// contract and should fail loudly.
export const DESCRIBE_ARGS = ["describe", "--tags", "--always", "--dirty"];

export function getAppVersion(opts = {}) {
	const env = opts.env ?? process.env;
	const exec = opts.exec ?? defaultExec;

	const fromEnv = env.APP_VERSION?.trim();
	if (fromEnv) return fromEnv;

	const fromGit = exec();
	if (fromGit) return fromGit;

	return FALLBACK;
}

export function defaultExec(cwd) {
	try {
		const out = execFileSync("git", DESCRIBE_ARGS, {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

// Allow `node scripts/compute-version.mjs` to print the version — handy for
// CI steps that need to populate `APP_VERSION` before invoking docker build.
if (import.meta.url === `file://${process.argv[1]}`) {
	process.stdout.write(`${getAppVersion()}\n`);
}

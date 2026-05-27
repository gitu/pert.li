#!/usr/bin/env node
// Resolves the human-readable build version surfaced to the running app
// (via `import.meta.env.VITE_APP_VERSION`) and to ops tooling.
//
// Precedence (first match wins):
//   1. APP_VERSION env var — CI injects `git describe --tags --always` so the
//      Docker build doesn't need .git inside the container.
//   2. `git describe --tags --always --dirty` against the working tree —
//      gives `v0.3.2`, `v0.3.2-4-gabc1234`, or `v0.3.2-4-gabc1234-dirty`
//      depending on tag/HEAD/working-tree state.
//   3. Fallback `0.0.0-dev` — no git history (e.g. a tarball install) and
//      no env override.

import { execFileSync } from "node:child_process";

const FALLBACK = "0.0.0-dev";

export function getAppVersion(opts = {}) {
	const env = opts.env ?? process.env;
	const exec = opts.exec ?? defaultExec;

	const fromEnv = env.APP_VERSION?.trim();
	if (fromEnv) return fromEnv;

	const fromGit = exec();
	if (fromGit) return fromGit;

	return FALLBACK;
}

function defaultExec() {
	try {
		const out = execFileSync(
			"git",
			["describe", "--tags", "--always", "--dirty"],
			{ stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
		);
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

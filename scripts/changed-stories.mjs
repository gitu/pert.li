#!/usr/bin/env node
// List storybook stories whose source file changed in this PR.
//
// Reads `storybook-static/index.json` (produced by `pnpm build-storybook`)
// and `git diff --name-only $BASE...HEAD` for `*.stories.tsx` files,
// then emits the intersection as JSON on stdout.
//
// Usage:
//   node scripts/changed-stories.mjs [baseRef] [indexJsonPath]
//
// Defaults: baseRef = $BASE_REF or "origin/main", indexJsonPath = "storybook-static/index.json".
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Pure helper for tests: given storybook's index.json contents and a
// list of changed story file paths (relative to the repo root), return
// the subset of stories whose `importPath` resolves to one of those
// files. Exported so the unit test can drive it without building
// storybook or touching git.
export function matchStoriesToFiles(index, changedFiles) {
	const entries = Object.values(index?.entries ?? {});
	const changedSet = new Set(changedFiles.map((p) => path.normalize(p)));
	return entries
		.filter((entry) => entry?.type !== "docs")
		.map((entry) => ({
			id: entry.id,
			title: entry.title,
			name: entry.name,
			// `importPath` is stored as e.g. "./src/components/foo.stories.tsx";
			// normalize to compare against `git diff`'s repo-root-relative paths.
			file: path.normalize(String(entry.importPath ?? "").replace(/^\.\//, "")),
		}))
		.filter((entry) => changedSet.has(entry.file));
}

function listChangedStoryFiles(baseRef) {
	const out = execSync(
		`git diff --name-only --diff-filter=ACMR ${JSON.stringify(baseRef)}...HEAD -- "src/**/*.stories.tsx"`,
		{ encoding: "utf8" },
	);
	return out
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((p) => path.normalize(p));
}

// Only run the side-effecting CLI when invoked directly (not when
// imported by a test). Using process.argv[1] avoids `import.meta.url`
// vs file:// URL mismatches across platforms.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith("changed-stories.mjs");

if (invokedDirectly) {
	const baseRef = process.argv[2] || process.env.BASE_REF || "origin/main";
	const indexPath = process.argv[3] || "storybook-static/index.json";

	const changed = listChangedStoryFiles(baseRef);

	if (changed.length === 0) {
		process.stdout.write(JSON.stringify({ stories: [], changedFiles: [] }, null, 2));
		process.exit(0);
	}

	if (!existsSync(indexPath)) {
		process.stderr.write(`changed-stories: ${indexPath} not found — did you run \`pnpm build-storybook\`?\n`);
		process.exit(1);
	}

	const index = JSON.parse(readFileSync(indexPath, "utf8"));
	const stories = matchStoriesToFiles(index, changed);
	process.stdout.write(JSON.stringify({ stories, changedFiles: changed }, null, 2));
}

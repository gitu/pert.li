#!/usr/bin/env node
// List storybook stories whose source file (or any sibling file in the
// same component directory) changed in this PR.
//
// Reads `storybook-static/index.json` (produced by `pnpm build-storybook`)
// and `git diff --name-only $BASE...HEAD` for any source file under
// `src/**`, then emits the affected stories as JSON on stdout.
//
// A story counts as "affected" when any changed file lives inside its
// owning directory tree — i.e. `dirname(storyImportPath) + "/"` is a
// prefix of the changed path. So touching `foo/bar.tsx` triggers
// `foo/bar.stories.tsx`, touching `foo/utils.ts` triggers every story
// under `foo/`, and touching `foo/sub/x.ts` triggers stories at or
// below `foo/`. Cross-cutting changes (shared utils outside any
// story's tree) intentionally do not trigger anything — keeps the
// PR comment focused.
//
// Usage:
//   node scripts/changed-stories.mjs [baseRef] [indexJsonPath]
//
// Defaults: baseRef = $BASE_REF or "origin/main", indexJsonPath = "storybook-static/index.json".
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Pure helper for tests: given storybook's index.json contents and a
// list of changed source files (relative to the repo root), return
// the stories whose owning directory contains at least one of those
// files. Exported so the unit test can drive it without building
// storybook or touching git.
export function matchStoriesToFiles(index, changedFiles) {
	const entries = Object.values(index?.entries ?? {});
	const normalizedChanges = changedFiles.map((p) => path.normalize(p));
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
		.filter((entry) => {
			// `dirname` returns the path without a trailing slash, so append
			// "/" before the prefix check to avoid matching e.g. `src/foo-bar/`
			// against a changed file `src/foo-baz/...`.
			const dir = `${path.dirname(entry.file)}/`;
			return normalizedChanges.some(
				(changed) => changed === entry.file || changed.startsWith(dir),
			);
		});
}

function listChangedSourceFiles(baseRef) {
	// Capture creations, modifications, renames AND deletions. A deletion
	// (e.g. removing a story) should still flag the story's directory as
	// touched so the comment + published screenshots stay in sync.
	const out = execSync(
		`git diff --name-only --diff-filter=ACMRD ${JSON.stringify(baseRef)}...HEAD -- "src/**"`,
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

	const changed = listChangedSourceFiles(baseRef);

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

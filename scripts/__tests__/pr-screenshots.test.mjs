import { describe, expect, it } from "vitest";
import {
	classifyScreenshotChanges,
	renderComment,
} from "../build-pr-screenshot-comment.mjs";
import { matchStoriesToFiles } from "../changed-stories.mjs";

// Minimal shape mirroring storybook's `storybook-static/index.json`.
// Real builds add a bunch of metadata; the matcher only reads
// `id`, `title`, `name`, `importPath`, `type`.
const INDEX = {
	v: 5,
	entries: {
		"foo-bar--default": {
			id: "foo-bar--default",
			title: "Foo/Bar",
			name: "Default",
			importPath: "./src/components/foo/bar.stories.tsx",
			type: "story",
		},
		"foo-bar--with-icon": {
			id: "foo-bar--with-icon",
			title: "Foo/Bar",
			name: "With Icon",
			importPath: "./src/components/foo/bar.stories.tsx",
			type: "story",
		},
		"foo-bar--docs": {
			id: "foo-bar--docs",
			title: "Foo/Bar",
			name: "docs",
			importPath: "./src/components/foo/bar.stories.tsx",
			type: "docs",
		},
		"widget--basic": {
			id: "widget--basic",
			title: "Widget",
			name: "Basic",
			// Each story lives in its own component dir — mirrors the
			// real repo, where stories are always nested 2+ levels deep
			// under `src/`. The matcher's dirname heuristic relies on
			// that convention to scope changes correctly.
			importPath: "./src/components/widget/widget.stories.tsx",
			type: "story",
		},
	},
};

describe("matchStoriesToFiles", () => {
	it("returns the stories whose importPath matches a changed file (and excludes docs)", () => {
		const out = matchStoriesToFiles(INDEX, ["src/components/foo/bar.stories.tsx"]);
		expect(out.map((s) => s.id).sort()).toEqual(["foo-bar--default", "foo-bar--with-icon"]);
		// Each match carries the normalized file path back to the caller
		// (the CI workflow uses it to render the file-path subtitle in the
		// sticky comment).
		expect(out.every((s) => s.file === "src/components/foo/bar.stories.tsx")).toBe(true);
	});

	it("matches a sibling source file in the same directory", () => {
		// Touching `bar.tsx` (the component the story renders) should
		// flag every story exported from `bar.stories.tsx`.
		const out = matchStoriesToFiles(INDEX, ["src/components/foo/bar.tsx"]);
		expect(out.map((s) => s.id).sort()).toEqual(["foo-bar--default", "foo-bar--with-icon"]);
	});

	it("matches a nested file under the story directory", () => {
		// Touching anything under `src/components/foo/` (e.g. a child
		// component or local util) should still flag stories at that
		// level — the dirname-prefix match walks the whole subtree.
		const out = matchStoriesToFiles(INDEX, ["src/components/foo/internal/helper.ts"]);
		expect(out.map((s) => s.id).sort()).toEqual(["foo-bar--default", "foo-bar--with-icon"]);
	});

	it("does NOT match a sibling directory with a shared prefix", () => {
		// `src/components/foo-bar/` must not bleed into stories living
		// in `src/components/foo/`. The matcher uses `dir + "/"` as the
		// prefix to defend against this.
		const out = matchStoriesToFiles(INDEX, ["src/components/foo-bar/anything.ts"]);
		expect(out).toEqual([]);
	});

	it("returns nothing when changes are outside every story's directory tree", () => {
		expect(matchStoriesToFiles(INDEX, ["src/lib/utils.ts"])).toEqual([]);
		expect(matchStoriesToFiles(INDEX, ["src/server/routes.ts"])).toEqual([]);
	});

	it("survives a malformed index", () => {
		expect(matchStoriesToFiles({}, ["src/components/foo/bar.stories.tsx"])).toEqual([]);
		expect(matchStoriesToFiles(null, ["src/components/foo/bar.stories.tsx"])).toEqual([]);
	});
});

describe("classifyScreenshotChanges", () => {
	it("splits git name-status output into added / modified / removed story ids", () => {
		const out = classifyScreenshotChanges(
			[
				"A\tscreenshots/foo-bar--new.png",
				"M\tscreenshots/foo-bar--default.png",
				"D\tscreenshots/old--story.png",
			].join("\n"),
		);
		expect(out).toEqual({
			added: ["foo-bar--new"],
			modified: ["foo-bar--default"],
			removed: ["old--story"],
		});
	});

	it("treats a rename as a removed old id plus an added new id", () => {
		const out = classifyScreenshotChanges(
			"R100\tscreenshots/widget--old.png\tscreenshots/widget--renamed.png",
		);
		expect(out.removed).toEqual(["widget--old"]);
		expect(out.added).toEqual(["widget--renamed"]);
	});

	it("ignores blank lines, non-png paths, and dedupes/sorts", () => {
		const out = classifyScreenshotChanges(
			["", "M\tscreenshots/b--two.png", "M\tscreenshots/a--one.png", "M\tscreenshots/README.md", "M\tscreenshots/a--one.png"].join(
				"\n",
			),
		);
		expect(out.modified).toEqual(["a--one", "b--two"]);
	});

	it("survives empty / nullish input", () => {
		expect(classifyScreenshotChanges("")).toEqual({ added: [], modified: [], removed: [] });
		expect(classifyScreenshotChanges(null)).toEqual({ added: [], modified: [], removed: [] });
	});
});

describe("renderComment", () => {
	const baseArgs = {
		repo: "gitu/pert.li",
		prNumber: "42",
		ref: "deadbeef1234567",
	};

	it("summarizes changes, links the Files-changed tab, and embeds thumbnails for changed/new ids", () => {
		const out = renderComment({
			...baseArgs,
			changes: {
				modified: ["foo-bar--default"],
				added: ["foo-bar--with-icon"],
				removed: ["gone--story"],
			},
			stories: [
				{ id: "foo-bar--default", title: "Foo/Bar", name: "Default", file: "src/components/foo/bar.stories.tsx" },
				{ id: "foo-bar--with-icon", title: "Foo/Bar", name: "With Icon", file: "src/components/foo/bar.stories.tsx" },
			],
		});
		// Summary line + deep link to the native diff.
		expect(out).toContain("1 changed · 1 new · 1 removed");
		expect(out).toContain("https://github.com/gitu/pert.li/pull/42/files");
		// Sections.
		expect(out).toContain("### Changed");
		expect(out).toContain("### New");
		expect(out).toContain("### Removed");
		// Readable labels from the changed-stories lookup, bare id as code.
		expect(out).toContain("**Foo/Bar — Default** `foo-bar--default`");
		expect(out).toContain("**Foo/Bar — With Icon** `foo-bar--with-icon`");
		// Thumbnails point at the committed baseline on the PR branch at the
		// new commit SHA — no separate branch, no `pr-<n>/` path.
		expect(out).toContain(
			"[![Foo/Bar — Default](https://raw.githubusercontent.com/gitu/pert.li/deadbeef1234567/screenshots/foo-bar--default.png)](https://raw.githubusercontent.com/gitu/pert.li/deadbeef1234567/screenshots/foo-bar--default.png)",
		);
		// Removed stories get no thumbnail (the PNG no longer exists).
		expect(out).not.toContain("screenshots/gone--story.png");
		// We no longer route through the old shared `screenshots` branch.
		expect(out).not.toContain("/screenshots/pr-42/");
		// Footer pins the baseline commit.
		expect(out).toContain("baselines @ deadbee");
	});

	it("falls back to the bare id when the story is not in the lookup", () => {
		const out = renderComment({
			...baseArgs,
			changes: { modified: ["x--y"], added: [], removed: [] },
			stories: [],
		});
		expect(out).toContain("**x--y** `x--y`");
	});

	it("renders the empty-state message when nothing changed", () => {
		const out = renderComment({
			...baseArgs,
			changes: { added: [], modified: [], removed: [] },
		});
		expect(out).toContain("No story screenshots changed");
		// No Files-changed link / thumbnails when there's nothing to show.
		expect(out).not.toContain("/files");
	});

	it("omits thumbnails when no ref is available", () => {
		const out = renderComment({
			repo: "gitu/pert.li",
			prNumber: "7",
			changes: { modified: ["a--b"], added: [], removed: [] },
		});
		expect(out).not.toMatch(/!\[/);
		expect(out).not.toContain("baselines @");
	});
});

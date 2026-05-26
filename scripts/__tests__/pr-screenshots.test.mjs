import { describe, expect, it } from "vitest";
import { renderComment } from "../build-pr-screenshot-comment.mjs";
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

describe("renderComment", () => {
	const baseArgs = {
		repo: "gitu/pert.li",
		prNumber: "42",
		headSha: "deadbeef1234",
		hasScreenshot: () => true,
	};

	it("groups stories by title and renders markdown links to the raw image URL", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{
					id: "foo-bar--default",
					title: "Foo/Bar",
					name: "Default",
					file: "src/components/foo/bar.stories.tsx",
				},
				{
					id: "foo-bar--with-icon",
					title: "Foo/Bar",
					name: "With Icon",
					file: "src/components/foo/bar.stories.tsx",
				},
			],
		});
		expect(out).toContain("### Foo/Bar");
		expect(out).toContain("`src/components/foo/bar.stories.tsx`");
		// Each story is a markdown link (so the reviewer's auth handles
		// raw.githubusercontent.com on click) — NOT an `<img>` tag (which
		// Camo would 404 on private repos).
		expect(out).toContain(
			"- [Default](https://raw.githubusercontent.com/gitu/pert.li/screenshots/pr-42/foo-bar--default.png)",
		);
		expect(out).toContain(
			"- [With Icon](https://raw.githubusercontent.com/gitu/pert.li/screenshots/pr-42/foo-bar--with-icon.png)",
		);
		expect(out).not.toMatch(/<img /);
		// The title heading appears only once even though we have two
		// stories under it.
		expect(out.match(/### Foo\/Bar/g)).toHaveLength(1);
	});

	it("renders a fallback line for stories whose screenshot is missing", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx" },
			],
			hasScreenshot: () => false,
		});
		expect(out).toContain("_render failed");
		// Missing-screenshot stories must not produce a link to a 404'd
		// image; they're rendered as bold name + "render failed" instead.
		expect(out).not.toMatch(/\]\(http/);
	});

	it("renders the empty-state message when nothing changed", () => {
		const out = renderComment({ ...baseArgs, stories: [] });
		expect(out).toContain("No story directories were touched");
	});

	it("trims the head sha to 7 chars in the footer", () => {
		const out = renderComment({
			...baseArgs,
			stories: [{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx" }],
		});
		expect(out).toContain("updated for deadbee");
	});
});

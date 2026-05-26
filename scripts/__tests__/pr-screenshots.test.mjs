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
		imageBaseUrl: "https://doc.pert.li",
		prNumber: "42",
		headSha: "deadbeef1234",
		hasScreenshot: () => true,
	};

	it("groups stories by title and links to the Pages-hosted image URL", () => {
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
		// URL includes a `?v=<sha7>` cache-buster to defeat GitHub's
		// Camo image proxy caching when the screenshot is republished
		// at the same path.
		expect(out).toContain("https://doc.pert.li/pr-42/foo-bar--default.png?v=deadbee");
		expect(out).toContain("https://doc.pert.li/pr-42/foo-bar--with-icon.png?v=deadbee");
		// The title heading appears only once even though we have two
		// stories under it.
		expect(out.match(/### Foo\/Bar/g)).toHaveLength(1);
	});

	it("strips a trailing slash from imageBaseUrl so URLs don't double up", () => {
		const out = renderComment({
			...baseArgs,
			imageBaseUrl: "https://doc.pert.li/",
			stories: [{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx" }],
		});
		expect(out).toContain("https://doc.pert.li/pr-42/x--y.png");
		expect(out).not.toContain("//pr-42");
	});

	it("renders a fallback for stories whose screenshot is missing", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx" },
			],
			hasScreenshot: () => false,
		});
		expect(out).toContain("_render failed");
		expect(out).not.toMatch(/<img /);
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

	it("omits the cache-buster when no headSha is provided", () => {
		const out = renderComment({
			...baseArgs,
			headSha: "",
			stories: [{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx" }],
		});
		expect(out).toContain("https://doc.pert.li/pr-42/x--y.png\"");
		expect(out).not.toMatch(/\?v=/);
	});
});

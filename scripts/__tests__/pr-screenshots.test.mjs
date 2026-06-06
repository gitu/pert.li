import { describe, expect, it } from "vitest";
import { renderComment } from "../build-pr-screenshot-comment.mjs";

describe("renderComment", () => {
	const baseArgs = {
		repo: "gitu/pert.li",
		prNumber: "42",
		headSha: "deadbeef1234",
		// Default: every requested PNG (after + diff) exists on disk.
		hasScreenshot: () => true,
	};
	const urlBase = "https://raw.githubusercontent.com/gitu/pert.li/screenshots/pr-42";

	it("groups changed stories by title and embeds after + diff, both linked full-size", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{
					id: "foo-bar--default",
					title: "Foo/Bar",
					name: "Default",
					file: "src/components/foo/bar.stories.tsx",
					status: "changed",
				},
				{
					id: "foo-bar--with-icon",
					title: "Foo/Bar",
					name: "With Icon",
					file: "src/components/foo/bar.stories.tsx",
					status: "changed",
				},
			],
		});
		expect(out).toContain("## 📸 Visual changes");
		expect(out).toContain("2 stories changed visually against the `main` baseline.");
		expect(out).toContain("### Foo/Bar");
		expect(out).toContain("`src/components/foo/bar.stories.tsx`");
		// New render embed, linked to the full-size PNG.
		expect(out).toContain(
			`[![Default](${urlBase}/foo-bar--default.png)](${urlBase}/foo-bar--default.png)`,
		);
		// Diff overlay embed for a changed story.
		expect(out).toContain(
			`[![Default diff](${urlBase}/foo-bar--default.diff.png)](${urlBase}/foo-bar--default.diff.png)`,
		);
		expect(out).toContain("**Default**");
		expect(out).toContain("**With Icon**");
		// Title heading appears once even with two stories under it.
		expect(out.match(/### Foo\/Bar/g)).toHaveLength(1);
	});

	it("embeds only the new render (no diff overlay) for a new story", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "w--basic", title: "Widget", name: "Basic", file: "src/w.stories.tsx", status: "new" },
			],
		});
		expect(out).toContain("**Basic** — 🆕 _new story_");
		expect(out).toContain(`[![Basic](${urlBase}/w--basic.png)](${urlBase}/w--basic.png)`);
		// A brand-new story has no baseline, so no diff overlay is referenced.
		expect(out).not.toContain("w--basic.diff.png");
	});

	it("flags a size change and skips the diff overlay (dimensions differ)", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{
					id: "w--basic",
					title: "Widget",
					name: "Basic",
					file: "src/w.stories.tsx",
					status: "changed",
					sizeChanged: true,
				},
			],
		});
		expect(out).toContain("**Basic** — ↔ _size changed_");
		expect(out).toContain(`[![Basic](${urlBase}/w--basic.png)]`);
		// pixelmatch can't diff unequal sizes, so no overlay is embedded.
		expect(out).not.toContain("w--basic.diff.png");
	});

	it("renders a removed story as a text line with no image", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "gone--x", title: "Gone", name: "X", file: "src/gone.stories.tsx", status: "removed" },
			],
		});
		expect(out).toContain("**X** — 🗑 _story removed_");
		// No image link for a removed story.
		expect(out).not.toMatch(/!\[X\]\(http/);
	});

	it("falls back to 'render failed' when the after PNG is missing", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx", status: "changed" },
			],
			hasScreenshot: () => false,
		});
		expect(out).toContain("_render failed");
		// Missing-screenshot stories must not produce a link to a 404'd image.
		expect(out).not.toMatch(/!\[/);
		expect(out).not.toMatch(/\]\(http/);
	});

	it("embeds the after render even when the diff overlay is missing", () => {
		// A changed story whose overlay failed to write should still show the
		// new render rather than collapsing to "render failed".
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx", status: "changed" },
			],
			hasScreenshot: (_story, suffix) => suffix === "png",
		});
		expect(out).toContain(`[![Y](${urlBase}/x--y.png)]`);
		expect(out).not.toContain("x--y.diff.png");
	});

	it("renders the empty-state message when nothing changed", () => {
		const out = renderComment({ ...baseArgs, stories: [] });
		expect(out).toContain("No stories changed visually against the `main` baseline.");
	});

	it("trims the head sha to 7 chars in the footer", () => {
		const out = renderComment({
			...baseArgs,
			stories: [
				{ id: "x--y", title: "X", name: "Y", file: "src/x.stories.tsx", status: "changed" },
			],
		});
		expect(out).toContain("updated for deadbee");
	});
});

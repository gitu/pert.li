import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { OverviewSummaryCard } from "./overview-summary-card";

const meta: Meta<typeof OverviewSummaryCard> = {
	title: "PERT/Overview/OverviewSummaryCard",
	component: OverviewSummaryCard,
	parameters: { layout: "padded" },
	args: { onSummarize: fn() },
};
export default meta;

type Story = StoryObj<typeof OverviewSummaryCard>;

export const Idle: Story = {
	args: { state: { status: "idle" } },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("overview-ai-summarize"));
		expect(args.onSummarize).toHaveBeenCalledTimes(1);
	},
};

export const Loading: Story = { args: { state: { status: "loading" } } };

export const Done: Story = {
	args: {
		state: {
			status: "done",
			text: "## Overview\n\nThis **28-task** launch plan runs ~47 working days (Jun 1 → Aug 6), with 9 tasks on the critical path and *38% complete*. See [the docs](https://example.com) for more.\n\n### Top risks\n\n- A long critical path leaves little float.\n- Most scope is still **not started** against a near finish date.",
		},
	},
	play: async ({ canvasElement }) => {
		const card = within(canvasElement).getByTestId("overview-ai-summary");
		// Streamdown renders asynchronously — wait for the markdown to mount.
		await waitFor(() => {
			// Markdown is rendered as real elements (headings, lists, emphasis).
			expect(card.querySelector("h2")).not.toBeNull();
			expect(card.querySelector("li")).not.toBeNull();
			expect(card.querySelector('[data-streamdown="strong"]')).not.toBeNull();
		});
		// …but links are stripped to plain text — no anchor survives, while the
		// link's label text is kept (unwrapDisallowed).
		expect(card.querySelector("a")).toBeNull();
		expect(card.textContent).toContain("the docs");
	},
};

export const Errored: Story = {
	args: {
		state: {
			status: "error",
			message: "No AI provider is configured on the server.",
		},
	},
};

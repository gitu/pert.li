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

// Read-only (a view-share recipient): the summarize action is the read-only
// version of the summary. `generateProjectSummary` is session-gated on the
// server — an anonymous viewer must not be able to spend the operator's key —
// so the button is disabled and clicking it is inert. A hint explains why.
export const ReadOnly: Story = {
	args: { state: { status: "idle" }, disabled: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Disabled (pointer-events:none) → the session-gated regenerate can't be
		// triggered by an anonymous viewer. The disabled attribute is the gate.
		await expect(
			await canvas.findByTestId("overview-ai-summarize"),
		).toBeDisabled();
		await expect(
			canvas.getByText(/switch to edit mode to generate a summary/i),
		).toBeVisible();
	},
};

// A summary that was generated before the link was shared stays readable in a
// read-only context — the text renders even though regenerate is disabled.
export const ReadOnlyWithSummary: Story = {
	args: {
		state: {
			status: "done",
			text: "## Overview\n\nThis launch plan runs ~47 working days with 9 tasks on the critical path.\n\n### Top risks\n\n- A long critical path leaves little float.",
		},
		disabled: true,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const card = canvas.getByTestId("overview-ai-summary");
		await waitFor(() => expect(card.querySelector("h2")).not.toBeNull());
		// The regenerate action is disabled, but the summary itself is visible.
		await expect(canvas.getByTestId("overview-ai-summarize")).toBeDisabled();
		expect(card.textContent).toContain("critical path");
	},
};

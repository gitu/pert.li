import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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
			text: "This 28-task launch plan runs ~47 working days (Jun 1 → Aug 6), with 9 tasks on the critical path and 38% complete.\n\nRisks:\n- A long critical path leaves little float.\n- Most scope is still not started against a near finish date.",
		},
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

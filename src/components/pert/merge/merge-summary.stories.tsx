import type { Meta, StoryObj } from "@storybook/react-vite";
import { MergeSummary } from "./merge-summary";

const meta: Meta<typeof MergeSummary> = {
	title: "Pert / Merge / MergeSummary",
	component: MergeSummary,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof MergeSummary>;

export const NoConflicts: Story = {
	args: { clean: 7, conflict: 0, skipped: 0 },
};

export const WithConflicts: Story = {
	args: { clean: 5, conflict: 2, skipped: 1 },
};

export const AllSkipped: Story = {
	args: { clean: 0, conflict: 3, skipped: 3 },
};

export const Empty: Story = {
	args: { clean: 0, conflict: 0, skipped: 0 },
};

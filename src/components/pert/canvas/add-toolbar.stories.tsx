import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { CanvasAddToolbar } from "./toolbar";

const meta: Meta<typeof CanvasAddToolbar> = {
	title: "Pert/Canvas/AddToolbar",
	component: CanvasAddToolbar,
	parameters: { layout: "centered" },
	args: { onAddTask: fn(), onAddMilestone: fn() },
};

export default meta;

type Story = StoryObj<typeof CanvasAddToolbar>;

// Task + Milestone only — groups come from the plan / WBS hierarchy, so the
// board no longer offers an "Add group" button.
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByTestId("toolbar-add-task")).toBeInTheDocument();
		expect(canvas.getByTestId("toolbar-add-milestone")).toBeInTheDocument();
		expect(canvas.queryByTestId("toolbar-add-group")).toBeNull();
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CanvasLegend } from "./canvas-legend";

const meta: Meta<typeof CanvasLegend> = {
	title: "Pert/Canvas/CanvasLegend",
	component: CanvasLegend,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof CanvasLegend>;

export const Default: Story = {};

// Opening the popover reveals the colour key with every node-state row.
export const Opened: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("canvas-legend"));
		// Popover renders in a portal — query the whole document body.
		const body = within(document.body);
		const content = await body.findByTestId("canvas-legend-content");
		expect(content).toBeInTheDocument();
		expect(within(content).getByText("Critical path")).toBeInTheDocument();
		expect(within(content).getByText("Cycle / blocked")).toBeInTheDocument();
		expect(within(content).getByText("Likely critical")).toBeInTheDocument();
	},
};

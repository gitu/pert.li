import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { CanvasPrefs } from "#/lib/pert/canvas-prefs";
import { CanvasViewToolbar } from "./toolbar";

const PREFS: CanvasPrefs = {
	edgeStyle: "bezier",
	spacing: "comfortable",
	continuousLayout: false,
	groupingMaxLevel: Number.POSITIVE_INFINITY,
};

const meta: Meta<typeof CanvasViewToolbar> = {
	title: "Pert/Canvas/ViewToolbar",
	component: CanvasViewToolbar,
	// Reserve room for the Display dropdown (portaled, opens to the right) so the
	// open-menu stories aren't clipped by the story frame.
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div style={{ minHeight: 420, minWidth: 360 }}>
				<Story />
			</div>
		),
	],
	args: {
		prefs: PREFS,
		onSetEdgeStyle: fn(),
		onSetSpacing: fn(),
		onRelayout: fn(),
		onToggleContinuous: fn(),
		onCollapseAll: fn(),
		onExpandAll: fn(),
		onSetGroupingLevel: fn(),
	},
};

export default meta;

type Story = StoryObj<typeof CanvasViewToolbar>;

export const Default: Story = {};

// Showcase: open the Display dropdown and leave it open so the grouping-depth
// control is actually visible when browsing Storybook. Also asserts every
// option is present.
export const GroupingControl: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("toolbar-display"));
		// Dropdown content renders in a portal at the document root.
		const body = within(document.body);
		for (const v of ["off", "1", "2", "3", "all"]) {
			expect(
				await body.findByTestId(`toolbar-grouping-${v}`),
			).toBeInTheDocument();
		}
	},
};

// Interaction: picking an option calls onSetGroupingLevel with the mapped cap.
export const SelectsGroupingLevel: Story = {
	play: async ({ args }) => {
		// Menu opens in a portal; query the document body.
		const body = within(document.body);
		await userEvent.click(await body.findByTestId("toolbar-display"));
		await userEvent.click(await body.findByTestId("toolbar-grouping-2"));
		expect(args.onSetGroupingLevel).toHaveBeenCalledWith(2);
	},
};

// When the project has no groups, callers omit onSetGroupingLevel and the
// Grouping section is hidden entirely.
export const NoGroupsHidesGroupingControl: Story = {
	args: { onSetGroupingLevel: undefined },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("toolbar-display"));
		const body = within(document.body);
		// Edge-style options exist, but no grouping radio.
		expect(await body.findByTestId("toolbar-edge-bezier")).toBeInTheDocument();
		expect(body.queryByTestId("toolbar-grouping-off")).toBeNull();
	},
};

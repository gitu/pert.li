import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasLoading } from "./canvas-loading";

const meta = {
	title: "Canvas/CanvasLoading",
	component: CanvasLoading,
	parameters: {
		layout: "fullscreen",
	},
	tags: ["autodocs"],
	decorators: [
		(Story) => (
			<div className="h-svh w-full bg-background">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CanvasLoading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InitializingRepo: Story = {
	args: { message: "Initializing local sync repo…" },
};

export const CreatingDocument: Story = {
	args: { message: "Creating local document…" },
};

export const LoadingDocument: Story = {
	args: { message: "Loading document…" },
};

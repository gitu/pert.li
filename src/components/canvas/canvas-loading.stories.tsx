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

// Shown when the sync server hasn't delivered the document yet (slow auth
// round-trip, server cold start, or genuinely missing doc). The document
// self-heals when the connection lands; Retry is for impatient humans.
export const DocumentUnavailable: Story = {
	args: {
		message: "Waiting for the sync server to deliver this document…",
		detail:
			"This can happen right after connecting. The document loads automatically as soon as it's available.",
		action: { label: "Retry now", onClick: () => {} },
	},
};

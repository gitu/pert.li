import type { Meta, StoryObj } from "@storybook/react-vite";
import { VersionFooter } from "./version-footer";

const meta: Meta<typeof VersionFooter> = {
	title: "Legal/VersionFooter",
	component: VersionFooter,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof VersionFooter>;

export const Default: Story = {
	render: () => (
		<div className="bg-background p-8">
			<VersionFooter />
		</div>
	),
};

export const Inline: Story = {
	render: () => (
		<div className="bg-background p-8">
			<VersionFooter className="text-xs text-muted-foreground" />
		</div>
	),
};

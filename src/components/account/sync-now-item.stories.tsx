import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { SyncNowItemView } from "./sync-now-item";

// Render the menu item inside an open dropdown so it gets the Radix menu
// context (and is visible without a click). `modal={false}` keeps the portal
// interactive for the play function.
const meta: Meta<typeof SyncNowItemView> = {
	title: "Account/SyncNowItem",
	component: SyncNowItemView,
	parameters: { layout: "centered" },
	args: { onSelect: fn() },
	render: (args) => (
		<DropdownMenu open modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost">Account</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-56">
				<SyncNowItemView {...args} />
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
export default meta;
type Story = StoryObj<typeof SyncNowItemView>;

export const Idle: Story = {
	args: { state: "idle" },
};

export const Syncing: Story = {
	name: "Syncing (in flight)",
	args: { state: "syncing" },
};

export const Offline: Story = {
	args: { state: "offline" },
};

export const ClickFires: Story = {
	name: "Click fires onSelect",
	args: { state: "idle" },
	play: async ({ args, canvasElement }) => {
		// Radix renders the menu content in a portal at document.body.
		const body = within(canvasElement.ownerDocument.body);
		const item = await body.findByText("Sync all projects");
		await userEvent.click(item);
		await expect(args.onSelect).toHaveBeenCalledTimes(1);
	},
};

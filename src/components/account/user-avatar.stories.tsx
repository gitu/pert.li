import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserAvatar } from "./user-avatar";

const meta: Meta<typeof UserAvatar> = {
	title: "Account/UserAvatar",
	component: UserAvatar,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof UserAvatar>;

export const ExplicitImage: Story = {
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image:
			"https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=128&h=128&fit=crop&crop=face",
		size: 48,
	},
};

export const GravatarFallback: Story = {
	name: "Gravatar lookup (no explicit image)",
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		size: 48,
	},
};

export const InitialsOnly: Story = {
	name: "Initials when no image & no Gravatar",
	args: {
		// Force the Gravatar lookup to 404 by using an obviously synthetic email.
		name: "Ada Lovelace",
		email: "definitely-not-a-real-mailbox-xyz@example.invalid",
		image: null,
		size: 48,
	},
};

export const Tiny: Story = {
	args: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		size: 20,
	},
};

export const NoNameNoEmail: Story = {
	args: {
		name: null,
		email: "",
		image: null,
		size: 48,
	},
};

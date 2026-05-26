import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminPanel } from "./admin-panel";

const meta: Meta<typeof AdminPanel> = {
	title: "Admin/AdminPanel",
	component: AdminPanel,
};
export default meta;
type Story = StoryObj<typeof AdminPanel>;

const sampleUsers = [
	{
		id: "u1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		isAdmin: true,
		createdAt: "2026-01-12T10:30:00Z",
	},
	{
		id: "u2",
		name: "Linus Torvalds",
		email: "linus@example.com",
		isAdmin: false,
		createdAt: "2026-02-21T08:15:00Z",
	},
	{
		id: "u3",
		name: "",
		email: "no-name@example.com",
		isAdmin: false,
		createdAt: "2026-04-02T17:45:00Z",
	},
	{
		id: "u4",
		name: "Grace Hopper",
		email: "grace@example.com",
		isAdmin: false,
		createdAt: "2026-05-10T09:00:00Z",
	},
];

export const Default: Story = {
	render: () => (
		<AdminPanel
			stats={{
				users: 4,
				admins: 1,
				workspaces: 3,
				projects: 12,
				activeSessions: 2,
			}}
			users={sampleUsers}
		/>
	),
};

export const EmptyInstance: Story = {
	name: "Empty (fresh self-host)",
	render: () => (
		<AdminPanel
			stats={{
				users: 0,
				admins: 0,
				workspaces: 0,
				projects: 0,
				activeSessions: 0,
			}}
			users={[]}
		/>
	),
};

export const SoloAdmin: Story = {
	name: "Solo admin (first sign-up)",
	render: () => (
		<AdminPanel
			stats={{
				users: 1,
				admins: 1,
				workspaces: 1,
				projects: 0,
				activeSessions: 1,
			}}
			users={[sampleUsers[0]]}
		/>
	),
};

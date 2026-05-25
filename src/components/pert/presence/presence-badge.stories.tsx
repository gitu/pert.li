import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, within } from "storybook/test";
import { presenceStore } from "#/lib/automerge/presence-store";
import { PresenceBadge } from "./presence-badge";

// Storybook-only seed: write peers directly into the store so we can render
// the badge in isolation without a real Automerge handle.

function Seed({
	projectId,
	peers,
}: {
	projectId: string;
	peers: Array<{
		peerId: string;
		userId: string;
		displayName: string | null;
		selectedTaskId: string | null;
	}>;
}) {
	useEffect(() => {
		presenceStore.setState({ projectId, peers });
		return () => {
			presenceStore.setState({ projectId: null, peers: [] });
		};
	}, [projectId, peers]);
	return null;
}

const meta: Meta<typeof PresenceBadge> = {
	title: "PERT/Presence/Badge",
	component: PresenceBadge,
	parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof PresenceBadge>;

export const SinglePeer: Story = {
	render: () => (
		<div className="relative size-16 rounded-md border bg-card">
			<Seed
				projectId="p"
				peers={[
					{
						peerId: "peer-1",
						userId: "user-aaa",
						displayName: "Alice Astronaut",
						selectedTaskId: "T",
					},
				]}
			/>
			<PresenceBadge taskId="T" className="absolute -right-2 -top-2" />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const badge = await canvas.findByTestId("presence-badge-T");
		expect(badge.textContent).toContain("A");
	},
};

export const ThreePeersPlusOverflow: Story = {
	render: () => (
		<div className="relative size-16 rounded-md border bg-card">
			<Seed
				projectId="p"
				peers={[
					{
						peerId: "p-1",
						userId: "user-aaa",
						displayName: "Alice",
						selectedTaskId: "T",
					},
					{
						peerId: "p-2",
						userId: "user-bbb",
						displayName: "Bob",
						selectedTaskId: "T",
					},
					{
						peerId: "p-3",
						userId: "user-ccc",
						displayName: "Carol",
						selectedTaskId: "T",
					},
					{
						peerId: "p-4",
						userId: "user-ddd",
						displayName: "Dan",
						selectedTaskId: "T",
					},
					{
						peerId: "p-5",
						userId: "user-eee",
						displayName: "Erin",
						selectedTaskId: "T",
					},
				]}
			/>
			<PresenceBadge taskId="T" max={3} className="absolute -right-2 -top-2" />
		</div>
	),
};

export const Empty: Story = {
	render: () => (
		<div className="relative size-16 rounded-md border bg-card">
			<Seed projectId="p" peers={[]} />
			<PresenceBadge taskId="T" className="absolute -right-2 -top-2" />
		</div>
	),
};

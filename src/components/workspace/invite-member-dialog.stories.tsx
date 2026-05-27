import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { Button } from "#/components/ui/button";
import { InviteMemberDialog } from "./invite-member-dialog";

// QueryClient with retry disabled — failed server-fn calls (no Storybook
// backend) shouldn't loop endlessly while we're just snapshotting visuals.
function withQueryClient(children: React.ReactNode) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Infinity },
			mutations: { retry: false },
		},
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Harness({ workspaceId }: { workspaceId?: string }) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)}>Open invite dialog</Button>
			<InviteMemberDialog
				workspaceId={workspaceId}
				open={open}
				onOpenChange={setOpen}
			/>
		</div>
	);
}

const meta: Meta<typeof InviteMemberDialog> = {
	title: "Workspace / InviteMemberDialog",
	component: InviteMemberDialog,
	parameters: { layout: "fullscreen" },
	decorators: [(Story) => withQueryClient(<Story />)],
};
export default meta;

type Story = StoryObj<typeof InviteMemberDialog>;

// Default lands on the Share-link tab. With workspaceId undefined the list
// query is disabled, so the pane renders without trying to hit the server.
export const ShareLinkTab: Story = {
	render: () => <Harness workspaceId={undefined} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		const createBtn = await canvas.findByTestId("create-join-link");
		// Disabled because no workspaceId was provided.
		expect(createBtn).toBeDisabled();
	},
};

export const EmailTab: Story = {
	render: () => <Harness workspaceId={undefined} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		const emailTab = await canvas.findByRole("tab", { name: /by email/i });
		emailTab.click();
		const emailInput = await canvas.findByLabelText(/email/i);
		expect(emailInput).toBeInTheDocument();
	},
};

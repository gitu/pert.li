import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { Button } from "#/components/ui/button";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

function withQueryClient(node: React.ReactNode) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Infinity },
			mutations: { retry: false },
		},
	});
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function Harness() {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)}>
				Open create-workspace dialog
			</Button>
			<CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
		</div>
	);
}

const meta: Meta<typeof CreateWorkspaceDialog> = {
	title: "Workspace / CreateWorkspaceDialog",
	component: CreateWorkspaceDialog,
	parameters: { layout: "fullscreen" },
	decorators: [(Story) => withQueryClient(<Story />)],
};
export default meta;

type Story = StoryObj<typeof CreateWorkspaceDialog>;

export const Default: Story = {
	render: () => <Harness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		const input = await canvas.findByTestId("new-workspace-name");
		expect(input).toBeInTheDocument();
	},
};

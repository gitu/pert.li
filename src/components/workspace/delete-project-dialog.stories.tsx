import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, userEvent, within } from "storybook/test";
import { DeleteProjectDialog } from "./delete-project-dialog";

// The dialog calls the deleteProject server fn, which can't run in Storybook —
// the stories render it open so the visuals + the type-to-confirm gating can
// be inspected. Confirming fires a network request that fails harmlessly (the
// error renders inline). The dialog uses useQueryClient, so it needs a
// QueryClient in context.
function withProviders(children: React.ReactNode) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const meta: Meta<typeof DeleteProjectDialog> = {
	title: "Workspace / DeleteProjectDialog",
	component: DeleteProjectDialog,
	decorators: [(Story) => withProviders(<Story />)],
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof DeleteProjectDialog>;

export const Default: Story = {
	args: {
		project: {
			id: "00000000-0000-4000-8000-000000000001",
			title: "Q3 launch plan",
		},
		open: true,
		onOpenChange: () => {},
	},
};

export const WithBranches: Story = {
	args: {
		project: {
			id: "00000000-0000-4000-8000-000000000001",
			title: "Q3 launch plan",
			hasBranches: true,
		},
		open: true,
		onOpenChange: () => {},
	},
};

// The destructive button starts disabled and only enables once the typed text
// exactly matches the project title.
export const ConfirmGating: Story = {
	args: {
		project: {
			id: "00000000-0000-4000-8000-000000000001",
			title: "Q3 launch plan",
		},
		open: true,
		onOpenChange: () => {},
	},
	play: async ({ canvasElement }) => {
		// The dialog renders in a portal, so query the document body.
		const body = within(canvasElement.ownerDocument.body);
		const confirm = await body.findByTestId("delete-project-confirm");
		await expect(confirm).toBeDisabled();

		const input = await body.findByTestId("delete-project-confirm-input");
		await userEvent.type(input, "wrong");
		await expect(confirm).toBeDisabled();

		await userEvent.clear(input);
		await userEvent.type(input, "Q3 launch plan");
		await expect(confirm).toBeEnabled();
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { expect, userEvent, within } from "storybook/test";
import type { ProjectSummary } from "#/types/workspace";
import { ProjectActionsMenu } from "./project-actions-menu";

// ProjectActionsMenu uses useNavigate (must live inside a router) and renders
// ShareProjectDialog (useQueryClient). useOptionalRepo returns null without a
// RepoProvider, so Export just toasts "not ready" — fine for a visual story.
function withProviders(children: React.ReactNode) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{children}</>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return (
		<QueryClientProvider client={qc}>
			<RouterProvider router={router} defaultPreload={false} />
		</QueryClientProvider>
	);
}

const project: ProjectSummary = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "00000000-0000-4000-8000-0000000000aa",
	title: "Q3 launch plan",
	description: null,
	automergeDocUrl: "automerge:abc123" as ProjectSummary["automergeDocUrl"],
	createdAt: "2026-05-01T00:00:00.000Z",
	createdBy: "user_alice",
	parentProjectId: null,
	branchedFromHeads: null,
	branchedAt: null,
	archivedAt: null,
};

const meta: Meta<typeof ProjectActionsMenu> = {
	title: "Workspace / ProjectActionsMenu",
	component: ProjectActionsMenu,
	decorators: [(Story) => withProviders(<Story />)],
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ProjectActionsMenu>;

export const Trigger: Story = {
	args: { project },
};

// Open the menu and assert all four actions are present.
export const MenuOpen: Story = {
	args: { project },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = await canvas.findByTestId(`project-actions-${project.id}`);
		await userEvent.click(trigger);

		const body = within(canvasElement.ownerDocument.body);
		await expect(
			await body.findByTestId(`project-action-edit-${project.id}`),
		).toBeVisible();
		await expect(
			body.getByTestId(`project-action-share-${project.id}`),
		).toBeVisible();
		await expect(
			body.getByTestId(`project-action-export-${project.id}`),
		).toBeVisible();
		await expect(
			body.getByTestId(`project-action-delete-${project.id}`),
		).toBeVisible();
	},
};

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
import { expect, fn, userEvent, within } from "storybook/test";
import type { PendingProject } from "#/lib/sync/pending-projects";
import { ProjectDeletedPrompt } from "./project-deleted-prompt";

// The prompt calls registerProject (a server fn) and useNavigate, neither of
// which run in Storybook. Stories render it open so the visual + the wiring can
// be inspected; the onRestored/onDiscarded overrides keep clicks deterministic
// and side-effect-free. useNavigate needs a router, so the tree mounts inside a
// memory router (mirrors BranchProjectDialog's stories).
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

const pending: PendingProject = {
	localId: "00000000-0000-4000-8000-000000000001",
	title: "Q3 launch plan",
	automergeDocUrl: "automerge:2j9knpQ8rXq6mC1Yh7Vd4Z3sT5n" as never,
	createdAt: "2026-01-01T00:00:00.000Z",
	status: "registered",
	serverId: "00000000-0000-4000-8000-0000000000aa",
	attempts: 0,
};

const meta: Meta<typeof ProjectDeletedPrompt> = {
	title: "Workspace / ProjectDeletedPrompt",
	component: ProjectDeletedPrompt,
	decorators: [(Story) => withProviders(<Story />)],
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ProjectDeletedPrompt>;

export const Default: Story = {
	args: {
		pending,
		onRestored: fn(),
		onDiscarded: fn(),
	},
};

// Both actions are offered side by side; the restore button drives the
// re-register and the destructive button drops the local copy.
export const Interactive: Story = {
	args: {
		pending,
		onRestored: fn(),
		onDiscarded: fn(),
	},
	play: async ({ canvasElement, args }) => {
		// Rendered in a portal — query the document body.
		const body = within(canvasElement.ownerDocument.body);
		const restore = await body.findByTestId("project-deleted-restore");
		const discard = await body.findByTestId("project-deleted-discard");
		await expect(restore).toBeEnabled();
		await expect(discard).toBeEnabled();

		// Discard is local-only (removePending) so it resolves in Storybook and
		// invokes the override.
		await userEvent.click(discard);
		await expect(args.onDiscarded).toHaveBeenCalled();
	},
};

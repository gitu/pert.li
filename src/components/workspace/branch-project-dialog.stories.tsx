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
import { BranchProjectDialog } from "./branch-project-dialog";

// The dialog calls forkProject / updateProjectMeta — both server fns that
// can't run in Storybook. The stories render the dialog open so visuals can
// be inspected; submit is a no-op (network request fails harmlessly, error
// rendered inline in the dialog body).
//
// The dialog uses `useNavigate()`, so it has to live INSIDE the router (not
// as a sibling of RouterProvider). We register the story tree as the index
// route's component and let TanStack Router mount it for us.
function withProviders(children: React.ReactNode) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
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

const meta: Meta<typeof BranchProjectDialog> = {
	title: "Workspace / BranchProjectDialog",
	component: BranchProjectDialog,
	decorators: [(Story) => withProviders(<Story />)],
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof BranchProjectDialog>;

export const ForkMode: Story = {
	args: {
		mode: "fork",
		open: true,
		onOpenChange: () => {},
		parent: { id: "p1", title: "Mobile app launch" },
		existingBranchCount: 0,
	},
};

export const ForkModeWithSiblings: Story = {
	args: {
		mode: "fork",
		open: true,
		onOpenChange: () => {},
		parent: { id: "p1", title: "Mobile app launch" },
		existingBranchCount: 3,
	},
};

export const EditMode: Story = {
	args: {
		mode: "edit",
		open: true,
		onOpenChange: () => {},
		project: {
			id: "p2",
			title: "What-if Phase 2 (parallel QA)",
			description: "Trying to move QA in parallel with implementation",
			isBranch: true,
		},
	},
};

export const EditModeNoDescription: Story = {
	args: {
		mode: "edit",
		open: true,
		onOpenChange: () => {},
		project: {
			id: "p2",
			title: "Mobile app launch",
			description: null,
			isBranch: false,
		},
	},
};

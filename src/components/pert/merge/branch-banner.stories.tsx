import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { BranchBanner } from "./branch-banner";

function withRouter(children: React.ReactNode) {
	const root = createRootRoute({ component: () => <Outlet /> });
	const project = createRoute({
		getParentRoute: () => root,
		path: "/p/$projectId",
		component: () => <>{children}</>,
	});
	const router = createRouter({
		routeTree: root.addChildren([project]),
		history: createMemoryHistory({ initialEntries: ["/p/parent"] }),
	});
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof BranchBanner> = {
	title: "Pert / Merge / BranchBanner",
	component: BranchBanner,
	decorators: [(Story) => withRouter(<Story />)],
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof BranchBanner>;

export const Default: Story = {
	args: {
		parent: { id: "p1", title: "Mobile app launch" },
		branchTitle: "What-if Phase 2 (parallel QA)",
		description: "Trying to move QA in parallel with implementation",
		changeCount: 12,
		commentCount: 3,
		onOpenMerge: () => {},
		onOpenComments: () => {},
	},
};

export const NoDescription: Story = {
	args: {
		parent: { id: "p1", title: "Mobile app launch" },
		branchTitle: "Branch 2",
		description: null,
		changeCount: 1,
		commentCount: 0,
		onOpenMerge: () => {},
		onOpenComments: () => {},
	},
};

export const NoChanges: Story = {
	args: {
		parent: { id: "p1", title: "Mobile app launch" },
		branchTitle: "Fresh branch (nothing edited yet)",
		changeCount: 0,
		commentCount: 0,
		onOpenMerge: () => {},
		onOpenComments: () => {},
	},
};

export const ManyChanges: Story = {
	args: {
		parent: {
			id: "p1",
			title:
				"Mobile app launch with a very long title that should truncate nicely",
		},
		branchTitle: "Aggressive replan",
		description:
			"Reshuffling Q3 to fit the new commit dates — exploring a tighter sequence",
		changeCount: 47,
		commentCount: 11,
		onOpenMerge: () => {},
		onOpenComments: () => {},
	},
};

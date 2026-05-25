import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import type { ProjectSummary } from "#/types/workspace";
import { ProjectList } from "./project-list";

const fixtureProjects: ProjectSummary[] = [
	{
		id: "00000000-0000-4000-8000-000000000001",
		workspaceId: "00000000-0000-4000-8000-0000000000aa",
		title: "Q3 launch plan",
		automergeDocUrl: "automerge:abc123" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-05-01T00:00:00.000Z",
		createdBy: "user_alice",
	},
	{
		id: "00000000-0000-4000-8000-000000000002",
		workspaceId: "00000000-0000-4000-8000-0000000000aa",
		title: "Migrations playbook with a very long title that should truncate",
		automergeDocUrl: "automerge:def456" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-04-12T00:00:00.000Z",
		createdBy: "user_alice",
	},
	{
		id: "00000000-0000-4000-8000-000000000003",
		workspaceId: "00000000-0000-4000-8000-0000000000aa",
		title: "Customer onboarding revamp",
		automergeDocUrl: "automerge:ghi789" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-03-04T00:00:00.000Z",
		createdBy: "user_bob",
	},
];

// ProjectList renders <Link to="/p/$projectId">; the stories need a router
// context so those links don't throw.
function withRouter(children: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{children}</>,
	});
	const projectRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/p/$projectId",
		component: () => <>{children}</>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, projectRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof ProjectList> = {
	title: "Workspace / ProjectList",
	component: ProjectList,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="w-56 rounded-md border bg-sidebar p-2">
				{withRouter(<Story />)}
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof ProjectList>;

export const Empty: Story = {
	args: { projects: [] },
};

export const WithCustomEmptyMessage: Story = {
	args: {
		projects: [],
		empty: "Nothing here — invite a teammate to get started.",
	},
};

export const Several: Story = {
	args: { projects: fixtureProjects },
};

export const SeveralWithActive: Story = {
	args: {
		projects: fixtureProjects,
		activeProjectId: fixtureProjects[1].id,
	},
};

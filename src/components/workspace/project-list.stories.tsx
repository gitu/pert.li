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

function root(
	p: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "title">,
): ProjectSummary {
	return {
		workspaceId: "00000000-0000-4000-8000-0000000000aa",
		description: null,
		automergeDocUrl: "automerge:abc" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-05-01T00:00:00.000Z",
		createdBy: "user_alice",
		parentProjectId: null,
		branchedFromHeads: null,
		branchedAt: null,
		archivedAt: null,
		...p,
	};
}

const fixtureProjects: ProjectSummary[] = [
	root({
		id: "00000000-0000-4000-8000-000000000001",
		title: "Q3 launch plan",
		automergeDocUrl: "automerge:abc123" as ProjectSummary["automergeDocUrl"],
	}),
	root({
		id: "00000000-0000-4000-8000-000000000002",
		title: "Migrations playbook with a very long title that should truncate",
		automergeDocUrl: "automerge:def456" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-04-12T00:00:00.000Z",
	}),
	root({
		id: "00000000-0000-4000-8000-000000000003",
		title: "Customer onboarding revamp",
		automergeDocUrl: "automerge:ghi789" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-03-04T00:00:00.000Z",
		createdBy: "user_bob",
	}),
];

const fixtureProjectsWithBranches: ProjectSummary[] = [
	...fixtureProjects,
	root({
		id: "00000000-0000-4000-8000-000000000011",
		title: "What-if Phase 2 (parallel QA)",
		description: "Try moving QA in parallel with implementation",
		automergeDocUrl: "automerge:branch1" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-05-08T00:00:00.000Z",
		parentProjectId: "00000000-0000-4000-8000-000000000001",
		branchedFromHeads: ["abc"],
		branchedAt: "2026-05-08T00:00:00.000Z",
	}),
	root({
		id: "00000000-0000-4000-8000-000000000012",
		title: "What-if drop QA gate",
		description: null,
		automergeDocUrl: "automerge:branch2" as ProjectSummary["automergeDocUrl"],
		createdAt: "2026-05-09T00:00:00.000Z",
		parentProjectId: "00000000-0000-4000-8000-000000000001",
		branchedFromHeads: ["abc"],
		branchedAt: "2026-05-09T00:00:00.000Z",
	}),
];

const fixtureOrphanBranch: ProjectSummary[] = [
	root({
		id: "00000000-0000-4000-8000-000000000099",
		title: "Stranded branch (parent archived)",
		description: "Parent project was archived; this should still render.",
		automergeDocUrl: "automerge:orphan" as ProjectSummary["automergeDocUrl"],
		parentProjectId: "00000000-0000-4000-8000-00000000ffff",
		branchedFromHeads: ["abc"],
		branchedAt: "2026-04-01T00:00:00.000Z",
	}),
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

export const WithBranches: Story = {
	args: { projects: fixtureProjectsWithBranches },
};

export const WithBranchesActive: Story = {
	args: {
		projects: fixtureProjectsWithBranches,
		activeProjectId: fixtureProjectsWithBranches[3].id,
	},
};

export const OrphanBranch: Story = {
	args: { projects: fixtureOrphanBranch },
};

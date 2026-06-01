import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { expect, userEvent, within } from "storybook/test";
import { PlanViewSwitcher } from "./chat-panel";

// PlanViewSwitcher reads `useParams` / `useSearch` and calls `useNavigate`,
// so the stories need a router context. We mount a tiny router whose
// `/p/$projectId` route renders the switcher itself — that way navigating
// updates the URL without ever leaving the story.
function withRouter(initialEntries: string[]) {
	return function Wrapper({ children }: { children: React.ReactNode }) {
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
			validateSearch: (raw: Record<string, unknown>) => ({
				view: typeof raw.view === "string" ? raw.view : undefined,
			}),
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([indexRoute, projectRoute]),
			history: createMemoryHistory({ initialEntries }),
		});
		return <RouterProvider router={router} />;
	};
}

const meta: Meta<typeof PlanViewSwitcher> = {
	title: "AI/PlanViewSwitcher",
	component: PlanViewSwitcher,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-72 rounded border bg-muted/30 text-[10px]">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof PlanViewSwitcher>;

// Default — sitting on the network view. All four options visible, network
// is the "current" one (aria-pressed=true).
export const OnNetwork: Story = {
	decorators: [
		(Story) => {
			const Wrap = withRouter(["/p/proj_demo"]);
			return <Wrap>{Story()}</Wrap>;
		},
	],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const switcher = await canvas.findByTestId("chat-plan-view-switcher");
		expect(switcher).toBeInTheDocument();
		for (const id of ["network", "timeline", "table", "matrix"]) {
			const btn = await canvas.findByTestId(`chat-plan-view-${id}`);
			expect(btn).toBeInTheDocument();
		}
		const active = await canvas.findByTestId("chat-plan-view-network");
		expect(active).toHaveAttribute("aria-pressed", "true");
	},
};

// Visiting on the matrix tab — the matrix pill should be marked as active
// and clicking another view should change which pill is pressed (proves the
// hook re-renders after navigate).
export const OnMatrix: Story = {
	decorators: [
		(Story) => {
			const Wrap = withRouter(["/p/proj_demo?view=matrix"]);
			return <Wrap>{Story()}</Wrap>;
		},
	],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const matrix = await canvas.findByTestId("chat-plan-view-matrix");
		expect(matrix).toHaveAttribute("aria-pressed", "true");
		const table = await canvas.findByTestId("chat-plan-view-table");
		await userEvent.click(table);
		expect(table).toHaveAttribute("aria-pressed", "true");
		expect(matrix).toHaveAttribute("aria-pressed", "false");
	},
};

// Not on a project route → the switcher hides entirely.
export const NoActiveProject: Story = {
	decorators: [
		(Story) => {
			const Wrap = withRouter(["/"]);
			return <Wrap>{Story()}</Wrap>;
		},
	],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.queryByTestId("chat-plan-view-switcher")).toBeNull();
	},
};

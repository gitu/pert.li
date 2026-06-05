import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { expect, within } from "storybook/test";
import { BrandMark } from "./brand-mark";

// BrandMark renders a <Link to="/">, so stories need a router context or
// useLinkProps crashes on `null.isServer` (same pattern as CookieHint).
function withRouter(children: React.ReactNode) {
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
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof BrandMark> = {
	title: "Marketing/BrandMark",
	component: BrandMark,
	parameters: { layout: "centered" },
	decorators: [(Story) => withRouter(<Story />)],
};
export default meta;
type Story = StoryObj<typeof BrandMark>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("pert.li")).toBeInTheDocument();
	},
};

// Non-link variant (used where the lockup shouldn't navigate).
export const Static: Story = {
	args: { asLink: false },
};

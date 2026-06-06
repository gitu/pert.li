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
import { MarketingHeader } from "./marketing-header";

// The header's brand lockup and CTAs render <Link>s, so a router context is
// required. Register every path the header can navigate to.
function withRouter(children: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const routes = ["/", "/signin"].map((path) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path,
			component: () => <>{children}</>,
		}),
	);
	const router = createRouter({
		routeTree: rootRoute.addChildren(routes),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof MarketingHeader> = {
	title: "Marketing/MarketingHeader",
	component: MarketingHeader,
	parameters: { layout: "fullscreen" },
	decorators: [(Story) => withRouter(<Story />)],
};
export default meta;
type Story = StoryObj<typeof MarketingHeader>;

// Wide stage used on the landing page.
export const Wide: Story = {
	args: { width: "wide" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("link", { name: /get started/i }),
		).toBeInTheDocument();
		await expect(
			canvas.getByRole("link", { name: /^sign in$/i }),
		).toBeInTheDocument();
	},
};

// Narrower reading measure used on the about / privacy prose pages.
export const Reading: Story = {
	args: { width: "reading" },
};

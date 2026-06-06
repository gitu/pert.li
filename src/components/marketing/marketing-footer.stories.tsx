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
import { type AppConfig, AppConfigContext } from "#/lib/app-config";
import { MarketingFooter } from "./marketing-footer";

// The footer links to /about, /privacy, and /signin, so it needs a router
// context with those paths registered.
function withRouter(children: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const routes = ["/", "/about", "/privacy", "/signin"].map((path) =>
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

function withConfig(config: Partial<AppConfig>, children: React.ReactNode) {
	const value: AppConfig = {
		appName: "pert.li",
		appTitle: "pert.li — collaborative PERT planning",
		privacy: { mode: "default", externalUrl: null },
		...config,
	};
	return (
		<AppConfigContext.Provider value={value}>
			{children}
		</AppConfigContext.Provider>
	);
}

const meta: Meta<typeof MarketingFooter> = {
	title: "Marketing/MarketingFooter",
	component: MarketingFooter,
	parameters: { layout: "fullscreen" },
	decorators: [(Story) => withRouter(<Story />)],
};
export default meta;
type Story = StoryObj<typeof MarketingFooter>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("link", { name: /privacy/i }),
		).toBeInTheDocument();
		await expect(
			canvas.getByRole("link", { name: /github/i }),
		).toBeInTheDocument();
	},
};

// When privacy is disabled the policy link drops out of the footer.
export const PrivacyDisabled: Story = {
	decorators: [
		(Story) =>
			withConfig(
				{ privacy: { mode: "disabled", externalUrl: null } },
				<Story />,
			),
	],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("link", { name: /privacy/i })).toBeNull();
	},
};

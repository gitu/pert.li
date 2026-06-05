import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { expect, within } from "storybook/test";
import { type AppConfig, AppConfigContext } from "#/lib/app-config";
import { CookieHint } from "./cookie-hint";

// CookieHint renders a <Link to="/privacy">; stories need a router context
// or useLinkProps crashes on `null.isServer`.
function withRouter(children: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{children}</>,
	});
	const privacyRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/privacy",
		component: () => <>{children}</>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, privacyRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof CookieHint> = {
	title: "Legal/CookieHint",
	component: CookieHint,
	parameters: { layout: "fullscreen" },
	decorators: [(Story) => withRouter(<Story />)],
};
export default meta;
type Story = StoryObj<typeof CookieHint>;

const STORAGE_KEY = "pertli.cookieHintDismissed.v1";

function ClearStorage() {
	useEffect(() => {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {}
	}, []);
	return null;
}

export const Default: Story = {
	render: () => (
		<div className="min-h-svh bg-background p-6">
			<ClearStorage />
			<p className="text-sm text-muted-foreground">
				The banner sits fixed at the bottom of the page.
			</p>
			<CookieHint />
		</div>
	),
};

export const AlreadyDismissed: Story = {
	render: () => {
		// Simulate a returning visitor. The banner should not render.
		return (
			<div className="min-h-svh bg-background p-6 text-sm text-muted-foreground">
				<DismissOnMount />
				No banner should be visible — this user already dismissed it.
				<CookieHint />
			</div>
		);
	},
};

function DismissOnMount() {
	useEffect(() => {
		try {
			window.localStorage.setItem(STORAGE_KEY, "1");
		} catch {}
	}, []);
	return null;
}

function withConfig(config: Partial<AppConfig>) {
	return function ConfigDecorator(children: React.ReactNode) {
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
	};
}

// White-label brand: the banner copy reflects the configured app name.
// (The meta decorator already supplies the router context.)
export const CustomBrand: Story = {
	decorators: [(Story) => withConfig({ appName: "Acme Planner" })(<Story />)],
	render: () => (
		<div className="min-h-svh bg-background p-6">
			<ClearStorage />
			<CookieHint />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(/Acme Planner only stores cookies/),
		).toBeInTheDocument();
		await expect(
			canvas.getByRole("link", { name: /privacy policy/i }),
		).toBeInTheDocument();
	},
};

// Privacy dropped: the informational banner stays, but there's no policy page
// to link to, so the "Read the privacy policy" link is omitted.
export const PrivacyDisabled: Story = {
	decorators: [
		(Story) =>
			withConfig({ privacy: { mode: "disabled", externalUrl: null } })(
				<Story />,
			),
	],
	render: () => (
		<div className="min-h-svh bg-background p-6">
			<ClearStorage />
			<CookieHint />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText(/only stores cookies/)).toBeInTheDocument();
		await expect(
			canvas.queryByRole("link", { name: /privacy policy/i }),
		).not.toBeInTheDocument();
	},
};

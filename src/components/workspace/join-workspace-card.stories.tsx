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
import type { WorkspaceInvitationPreview } from "#/types/workspace";
import {
	JoinWorkspaceCard,
	type JoinWorkspaceCardProps,
} from "./join-workspace-card";

// Same trick as ProjectList stories — the card renders <Link to="/signin">
// and <Link to="/">, both of which need a Router context.
function withRouter(node: React.ReactNode) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{node}</>,
	});
	const signinRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/signin",
		component: () => null,
		validateSearch: (s: Record<string, unknown>) => ({
			callbackURL:
				typeof s.callbackURL === "string" ? s.callbackURL : undefined,
		}),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, signinRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return <RouterProvider router={router} />;
}

const meta: Meta<typeof JoinWorkspaceCard> = {
	title: "Workspace / JoinWorkspaceCard",
	component: JoinWorkspaceCard,
	parameters: { layout: "centered" },
	decorators: [(Story) => withRouter(<Story />)],
};
export default meta;

type Story = StoryObj<typeof JoinWorkspaceCard>;

const validPreview: WorkspaceInvitationPreview = {
	token: "tok_demo",
	workspaceId: "00000000-0000-4000-8000-0000000000aa",
	workspaceName: "Acme Planning",
	role: "editor",
	expiresAt: null,
	maxUses: null,
	useCount: 0,
	invalidReason: null,
};

const baseProps: JoinWorkspaceCardProps = {
	preview: validPreview,
	sessionPending: false,
	hasSession: true,
	tokenPath: "/join/tok_demo",
	pending: false,
	error: null,
	onAccept: () => {},
};

export const SignedIn: Story = {
	args: baseProps,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const btn = await canvas.findByTestId("join-accept-button");
		expect(btn).toBeEnabled();
	},
};

export const SignedOut: Story = {
	args: { ...baseProps, hasSession: false },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const cta = await canvas.findByTestId("join-signin-cta");
		expect(cta).toBeInTheDocument();
	},
};

export const Joining: Story = {
	args: { ...baseProps, pending: true },
};

export const AcceptError: Story = {
	args: {
		...baseProps,
		error: "Something went wrong. Try again in a moment.",
	},
};

export const NotFound: Story = {
	args: { ...baseProps, preview: null },
};

export const Revoked: Story = {
	args: {
		...baseProps,
		preview: { ...validPreview, invalidReason: "revoked" },
	},
};

export const Expired: Story = {
	args: {
		...baseProps,
		preview: { ...validPreview, invalidReason: "expired" },
	},
};

export const Exhausted: Story = {
	args: {
		...baseProps,
		preview: {
			...validPreview,
			maxUses: 5,
			useCount: 5,
			invalidReason: "exhausted",
		},
	},
};

export const SessionLoading: Story = {
	args: { ...baseProps, sessionPending: true, hasSession: false },
};

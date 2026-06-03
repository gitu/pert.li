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
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatPanel } from "./chat-panel";

// The chat-panel chunk gets top-level-await wrapping in the storybook static
// build (it transitively pulls in streamdown / mermaid, which use TLA), but
// rolldown's TLA plugin currently misses propagating `__tla` into this story
// bundle, so the default `n()` invocation rejects with "n is not a function".
// Any module-level `await` flips this file into TLA mode and rolldown then
// correctly awaits the dependency's `__tla` before invoking story exports.
await Promise.resolve();

// Wraps the panel in a fixed-size box so it has a chrome to scroll in.
function Stage({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-[520px] w-[420px] overflow-hidden rounded-md border bg-background">
			{children}
		</div>
	);
}

// Chat is bound to the active project — ChatPanel reads its projectId from
// the route (useParams), so the stories need a Router context. The initial
// path drives which scope the panel mounts in: `/p/<id>` for the active
// state, `/` for the NoActiveProject state. The QueryClientProvider is
// required since the panel's branch tools (create_branch) invalidate the
// ["projects"] query cache.
function withRouter(initialPath: string, children: React.ReactNode) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
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
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	});
	return (
		<QueryClientProvider client={qc}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

const meta: Meta<typeof ChatPanel> = {
	title: "AI/ChatPanel",
	component: ChatPanel,
	parameters: { layout: "centered" },
	decorators: [
		// Stories that want the no-project state set
		// `parameters.initialPath = "/"`.
		(Story, context) => {
			const initialPath =
				typeof context.parameters?.initialPath === "string"
					? context.parameters.initialPath
					: "/p/storybook-project";
			return <Stage>{withRouter(initialPath, <Story />)}</Stage>;
		},
	],
};

export default meta;

type Story = StoryObj<typeof ChatPanel>;

// The default story points at /api/chat — in Storybook that route doesn't
// exist, so we expect the panel to render but show an empty conversation
// until the user types. The send button is disabled while input is empty.
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const panel = await canvas.findByTestId("chat-panel");
		expect(panel).toBeInTheDocument();
		const input = await canvas.findByTestId("chat-input");
		expect(input).toBeInTheDocument();
		const send = await canvas.findByTestId("chat-send");
		expect(send).toBeDisabled();
	},
};

// Endpoint clearly broken — stays empty, never errors at construction time.
export const NoEndpoint: Story = {
	args: { endpoint: "/api/__missing__" },
};

// Seeded prompt for design review screenshots — text appears in the input on
// mount, so the send button enables immediately.
export const WithSeedPrompt: Story = {
	args: {
		initialPrompt: "Break the Q3 launch into 8 tasks with PERT estimates.",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const send = await canvas.findByTestId("chat-send");
		expect(send).not.toBeDisabled();
	},
};

// Drives the hidden <input type="file"> directly — exercises the markdown
// extraction path (no PDF/DOCX bundle needed) and the chip + parsed-state
// transition.
export const WithAttachedMarkdown: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = (await canvas.findByTestId(
			"chat-file-input",
		)) as HTMLInputElement;
		const file = new File(
			[
				"# Auth spec\n- OIDC discovery: needs token rotation\n- Session refresh: 24h sliding window\n",
			],
			"auth-spec.md",
			{ type: "text/markdown" },
		);
		await userEvent.upload(input, file);
		await waitFor(async () => {
			const chip = await canvas.findByTestId(/^chat-attachment-/);
			expect(chip).toHaveAttribute("data-status", "ready");
		});
		// Send is enabled when an attachment is ready even with empty body.
		const send = await canvas.findByTestId("chat-send");
		await waitFor(() => expect(send).not.toBeDisabled());
	},
};

// No active project — chat is bound to a project, so the panel falls back to
// an explainer instead of mounting a thread. `initialPath: "/"` swaps the
// memory router off the project route.
export const NoActiveProject: Story = {
	parameters: { initialPath: "/" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const panel = await canvas.findByTestId("chat-panel");
		expect(panel).toHaveAttribute("data-state", "no-project");
		// The input/send affordances are deliberately absent in this state.
		expect(canvas.queryByTestId("chat-input")).toBeNull();
		expect(canvas.queryByTestId("chat-send")).toBeNull();
	},
};

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
import { MONTE_CARLO_SAMPLE_TITLE } from "#/lib/pert/sample-montecarlo-project";
import { CreateProjectDialog } from "./create-project-dialog";

// The dialog mints an Automerge doc via the local sync repo and navigates on
// submit — neither is wired in Storybook (no repo provider), so submit fails
// harmlessly and the error renders inline. The stories exercise the wizard's
// step navigation and per-choice UI; the create plumbing is covered by the
// app's e2e/manual verification instead.
//
// The dialog uses `useNavigate()`, so it must live INSIDE the router. We
// register the story tree as the index route's component and let TanStack
// Router mount it for us (same pattern as branch-project-dialog.stories).
function withProviders(children: React.ReactNode) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
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
	return (
		<QueryClientProvider client={qc}>
			<RouterProvider router={router} defaultPreload={false} />
		</QueryClientProvider>
	);
}

const meta: Meta<typeof CreateProjectDialog> = {
	title: "Workspace / CreateProjectDialog",
	component: CreateProjectDialog,
	decorators: [(Story) => withProviders(<Story />)],
	parameters: { layout: "centered" },
	args: { open: true, onOpenChange: () => {} },
};
export default meta;

type Story = StoryObj<typeof CreateProjectDialog>;

// Step 1 — the four starting points.
export const ChooseStartingPoint: Story = {
	play: async ({ canvasElement }) => {
		// Dialog renders into a portal, so query the document body.
		const body = within(canvasElement.ownerDocument.body);
		for (const id of ["empty", "montecarlo", "tutorial", "ai"]) {
			await expect(body.getByTestId(`create-choice-${id}`)).toBeInTheDocument();
		}
	},
};

// Step 2 — a sample choice shows a pre-filled, editable title.
export const SampleTitleStep: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(body.getByTestId("create-choice-montecarlo"));
		const title = await body.findByLabelText("Title");
		await expect(title).toHaveValue(MONTE_CARLO_SAMPLE_TITLE);
	},
};

// Step 2 — the AI path reveals a description field and a "Create & draft" CTA.
export const DescribeWithAiStep: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(body.getByTestId("create-choice-ai"));

		const description = await body.findByLabelText("Describe your project");
		await userEvent.type(
			description,
			"Launch a mobile app with design, build, QA and a marketing push.",
		);
		await expect(description).toHaveValue(
			"Launch a mobile app with design, build, QA and a marketing push.",
		);

		await waitFor(() =>
			expect(
				body.getByRole("button", { name: "Create & draft" }),
			).toBeInTheDocument(),
		);
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectComment } from "#/types/workspace";
import { ProjectCommentsPanel } from "./project-comments-panel";

// The panel uses TanStack Query to fetch via the server fn. In Storybook we
// pre-seed the cache with fixture data, so the panel renders the list state
// straight from cache and never hits the (unavailable) server.
function withQuery(
	children: React.ReactNode,
	comments: ProjectComment[] | undefined,
	error?: Error,
) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	if (comments) {
		qc.setQueryData(["project-comments", "p1"], comments);
	}
	if (error) {
		// Force an error state by setting a rejected query result.
		qc.setQueryData(["project-comments", "p1"], () => {
			throw error;
		});
	}
	return (
		<QueryClientProvider client={qc}>
			<div className="h-96 w-96 border border-border bg-card">{children}</div>
		</QueryClientProvider>
	);
}

const meta: Meta<typeof ProjectCommentsPanel> = {
	title: "Workspace / ProjectCommentsPanel",
	component: ProjectCommentsPanel,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ProjectCommentsPanel>;

const seed: ProjectComment[] = [
	{
		id: "c1",
		projectId: "p1",
		authorId: "u1",
		authorName: "Ada Lovelace",
		body: "We need to decide whether QA runs in parallel before we ship this branch into main.",
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
		editedAt: null,
	},
	{
		id: "c2",
		projectId: "p1",
		authorId: "u2",
		authorName: "Bob Builder",
		body: "Agree — also worth pricing the contractor option.",
		createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
		editedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
	},
];

export const Empty: Story = {
	args: { projectId: "p1", currentUserId: "u1" },
	decorators: [(Story) => withQuery(<Story />, [])],
};

export const Several: Story = {
	args: { projectId: "p1", currentUserId: "u1" },
	decorators: [(Story) => withQuery(<Story />, seed)],
};

export const ManyAuthors: Story = {
	args: { projectId: "p1", currentUserId: "u3" },
	decorators: [(Story) => withQuery(<Story />, seed)],
};

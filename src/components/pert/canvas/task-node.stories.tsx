import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { TaskNode, type TaskNodeData } from "./task-node";

const nodeTypes = { task: TaskNode };

function NodeStage({
	data,
	selected,
}: {
	data: TaskNodeData;
	selected?: boolean;
}) {
	const node = {
		id: "demo",
		type: "task",
		position: { x: 60, y: 60 },
		data: data as unknown as Record<string, unknown>,
		width: 200,
		height: 80,
		selected,
	};
	return (
		<div className="h-[220px] w-[360px] rounded-md border bg-background">
			<ReactFlowProvider>
				<ReactFlow
					nodes={[node]}
					edges={[]}
					nodeTypes={nodeTypes}
					proOptions={{ hideAttribution: true }}
					fitView
					nodesDraggable={false}
					zoomOnScroll={false}
					panOnDrag={false}
				/>
			</ReactFlowProvider>
		</div>
	);
}

const meta = {
	title: "PERT/TaskNode",
	component: NodeStage,
	parameters: { layout: "centered" },
} satisfies Meta<typeof NodeStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		data: {
			title: "Design API surface",
			kind: "task",
			durationDays: 3.5,
			slackDays: 1.5,
			critical: false,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// React Flow mounts its shell synchronously but only renders nodes once
		// its ResizeObserver fires. In the bundled Storybook the play function
		// runs before that tick, so use `findByText` to retry until the node
		// appears instead of asserting on the first frame.
		await expect(
			await canvas.findByText("Design API surface"),
		).toBeInTheDocument();
	},
};

export const Critical: Story = {
	args: {
		data: {
			title: "Ship release",
			kind: "task",
			durationDays: 2,
			slackDays: 0,
			critical: true,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("critical")).toBeInTheDocument();
	},
};

export const InProgress: Story = {
	args: {
		data: {
			title: "Build auth flow",
			kind: "task",
			durationDays: 2.5,
			slackDays: 1,
			critical: false,
			hasEstimate: true,
			status: "in_progress",
			progress: 60,
		},
	},
	play: async ({ canvasElement }) => {
		await waitFor(() => {
			const node = canvasElement.querySelector(
				'[data-testid^="task-progress-"]',
			) as HTMLElement | null;
			expect(node).not.toBeNull();
			expect(node?.style.width).toBe("60%");
		});
	},
};

export const Completed: Story = {
	args: {
		data: {
			title: "Spec written",
			kind: "task",
			durationDays: 0,
			slackDays: 3,
			critical: false,
			hasEstimate: true,
			status: "completed",
			progress: 100,
		},
	},
};

export const HighCriticality: Story = {
	args: {
		data: {
			title: "Migrate database",
			kind: "task",
			durationDays: 4,
			slackDays: 2,
			critical: false,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			criticality: 0.92,
		},
	},
};

export const Milestone: Story = {
	args: {
		data: {
			title: "Beta launch",
			kind: "milestone",
			durationDays: 0,
			slackDays: 0,
			critical: false,
			hasEstimate: false,
			status: "not_started",
			progress: 0,
		},
	},
};

export const NoEstimate: Story = {
	args: {
		data: {
			title: "TBD discovery",
			kind: "task",
			durationDays: 0,
			slackDays: null,
			critical: false,
			hasEstimate: false,
			status: "not_started",
			progress: 0,
		},
	},
};

// Radial quick-add buttons appear on the left and right of the card,
// centred on the source/target handles. Always-visible here so reviewers
// can see the affordance without hovering the screenshot. The `play`
// function exercises the two button callbacks to lock the contract.
export const WithRadialQuickAdd: Story = {
	args: {
		selected: true,
		data: {
			title: "Design API surface",
			kind: "task",
			durationDays: 3.5,
			slackDays: 1.5,
			critical: false,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			onAddPredecessor: fn(),
			onAddSuccessor: fn(),
		},
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const predecessor = await canvas.findByTestId("task-add-predecessor-demo");
		const successor = await canvas.findByTestId("task-add-successor-demo");
		await expect(predecessor).toBeVisible();
		await expect(successor).toBeVisible();
		await userEvent.click(successor);
		await expect(args.data.onAddSuccessor).toHaveBeenCalledTimes(1);
		await userEvent.click(predecessor);
		await expect(args.data.onAddPredecessor).toHaveBeenCalledTimes(1);
	},
};

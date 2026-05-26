import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TooltipProvider } from "#/components/ui/tooltip";
import { TaskNode, type TaskNodeData } from "./task-node";

const nodeTypes = { task: TaskNode };

function NodeStage({
	data,
	selected,
}: {
	data: TaskNodeData;
	selected?: boolean;
}) {
	// The radial quick-add cluster sits ~48px outside the card on each side.
	// `fitView` only fits the node's reported bounds, so the cluster gets
	// clipped against the React Flow viewport. We render at a fixed viewport
	// with the node centred and enough horizontal slack to show both
	// clusters in full.
	const node = {
		id: "demo",
		type: "task",
		position: { x: 120, y: 60 },
		data: data as unknown as Record<string, unknown>,
		width: 200,
		height: 80,
		selected,
	};
	return (
		<TooltipProvider delayDuration={150}>
			<div className="h-[220px] w-[560px] rounded-md border bg-background">
				<ReactFlowProvider>
					<ReactFlow
						nodes={[node]}
						edges={[]}
						nodeTypes={nodeTypes}
						proOptions={{ hideAttribution: true }}
						defaultViewport={{ x: 0, y: 0, zoom: 1 }}
						nodesDraggable={false}
						zoomOnScroll={false}
						panOnDrag={false}
					/>
				</ReactFlowProvider>
			</div>
		</TooltipProvider>
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
		await expect(canvas.getByText("Design API surface")).toBeInTheDocument();
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
		await expect(canvas.getByText("critical")).toBeInTheDocument();
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
		const node = canvasElement.querySelector(
			'[data-testid^="task-progress-"]',
		) as HTMLElement | null;
		await expect(node).not.toBeNull();
		await expect(node?.style.width).toBe("60%");
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

// Radial quick-add cluster — a task button and a milestone button on each
// side, centred on the source/target connectors. Always-visible here so
// reviewers see the affordance without hovering the screenshot. The `play`
// function clicks each variant to lock the contract: both callbacks are
// invoked with the chosen kind.
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
		const predTask = await canvas.findByTestId(
			"task-add-predecessor-task-demo",
		);
		const predMilestone = await canvas.findByTestId(
			"task-add-predecessor-milestone-demo",
		);
		const succTask = await canvas.findByTestId("task-add-successor-task-demo");
		const succMilestone = await canvas.findByTestId(
			"task-add-successor-milestone-demo",
		);
		await expect(predTask).toBeVisible();
		await expect(succMilestone).toBeVisible();

		await userEvent.click(succTask);
		await expect(args.data.onAddSuccessor).toHaveBeenLastCalledWith("task");
		await userEvent.click(succMilestone);
		await expect(args.data.onAddSuccessor).toHaveBeenLastCalledWith(
			"milestone",
		);
		await userEvent.click(predTask);
		await expect(args.data.onAddPredecessor).toHaveBeenLastCalledWith("task");
		await userEvent.click(predMilestone);
		await expect(args.data.onAddPredecessor).toHaveBeenLastCalledWith(
			"milestone",
		);
	},
};

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { TaskNode, type TaskNodeData } from "./task-node";

const nodeTypes = { task: TaskNode };

function NodeStage({ data }: { data: TaskNodeData }) {
	const node = {
		id: "demo",
		type: "task",
		position: { x: 40, y: 40 },
		data: data as unknown as Record<string, unknown>,
		width: 200,
		height: 80,
	};
	return (
		<div className="h-[200px] w-[320px] rounded-md border bg-background">
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

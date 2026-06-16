import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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

// A task with linked external issues shows a compact badge under the card —
// "PROJ-1" for a single key, "N issues" for several (full list in a tooltip).
export const WithIssueLinks: Story = {
	args: {
		data: {
			title: "Wire up auth",
			kind: "task",
			durationDays: 2,
			slackDays: 1,
			critical: false,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			issueKeys: ["PROJ-12", "PROJ-13"],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByTestId("task-issues-demo"),
		).toHaveTextContent("2 issues");
	},
};

// Long titles truncate to one line normally and expand to the full text on
// hover (the title element carries group-hover utilities; the card grows past
// its min-height and overlays neighbours via the styles.css hover z rule).
export const LongTitleExpandsOnHover: Story = {
	args: {
		data: {
			title:
				"Implement the cross-region failover orchestration runbook including automated database promotion and DNS cutover validation",
			kind: "task",
			durationDays: 5,
			slackDays: 0,
			critical: true,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const title = await canvas.findByText(/cross-region failover/);
		// Truncated single-line by default…
		await expect(title).toHaveClass("truncate");
		// …with the hover-expand utilities wired up.
		await expect(title.className).toContain("group-hover:whitespace-normal");
		await expect(title.className).toContain("group-hover:break-words");
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

// Read-only (a view-share recipient): the canvas omits the mutating callbacks
// (`onDelete` / `onAddPredecessor` / `onAddSuccessor`) when `changeDoc` is
// withheld, so the node renders without any delete or quick-add affordance —
// even while selected. This is the canvas-side proof that a read-only viewer
// cannot delete or add tasks.
export const ReadOnly: Story = {
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
			// No onDelete / onAddPredecessor / onAddSuccessor.
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// The node itself still renders so the plan is viewable…
		await expect(
			await canvas.findByText("Design API surface"),
		).toBeInTheDocument();
		// …but none of the mutating affordances exist.
		expect(canvas.queryByTestId("task-delete-demo")).toBeNull();
		expect(canvas.queryByTestId("task-add-predecessor-task-demo")).toBeNull();
		expect(canvas.queryByTestId("task-add-successor-task-demo")).toBeNull();
	},
};

// DISPLAY-SETTINGS: per-project field toggles. Hiding slack drops the "Nd
// slack" segment from the meta line; the duration segment stays.
export const SlackHidden: Story = {
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
			showSlack: false,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Design API surface");
		// Duration still shown, slack segment gone.
		await expect(await canvas.findByText(/3\.5 d/)).toBeInTheDocument();
		expect(canvas.queryByText(/slack/i)).toBeNull();
	},
};

// Hiding the progress field suppresses the in-flight progress bar.
export const ProgressHidden: Story = {
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
			showProgress: false,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Build auth flow");
		expect(
			canvasElement.querySelector('[data-testid^="task-progress-"]'),
		).toBeNull();
	},
};

// Hiding the issue-links field suppresses the external-issue badge even when the
// task has issue keys (the display toggle wins over the data being present).
export const IssueLinksHidden: Story = {
	args: {
		data: {
			title: "Wire up auth",
			kind: "task",
			durationDays: 2,
			slackDays: 1,
			critical: false,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			issueKeys: ["PROJ-12", "PROJ-13"],
			showIssueKeys: false,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Wire up auth");
		// The task has issue keys, but the badge is gated off by the display toggle.
		expect(canvas.queryByTestId("task-issues-demo")).toBeNull();
	},
};

// Compact density: the node carries data-layout="compact" and tightens its
// internal spacing (reported height is unchanged for the canvas layout math).
export const CompactLayout: Story = {
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
			layout: "compact",
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Design API surface");
		const node = canvasElement.querySelector(
			'[data-testid="task-node-demo"]',
		) as HTMLElement | null;
		expect(node).not.toBeNull();
		expect(node).toHaveAttribute("data-layout", "compact");
	},
};

// PARALLEL-STAFFING: the opt-in node badge — a ⚡N→Xd hint, distinct from the
// duration. Shown only when the display field is on AND ≥2 people apply.
export const StaffingBadge: Story = {
	args: {
		data: {
			title: "Migrate database",
			kind: "task",
			durationDays: 20,
			slackDays: 0,
			critical: true,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			showStaffing: true,
			staffingPeople: 4,
			staffingDays: 5,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Migrate database");
		// The duration (20 d) is untouched; the badge is a separate ⚡ segment.
		await expect(await canvas.findByText(/20 d/)).toBeInTheDocument();
		await expect(await canvas.findByText(/⚡4→5d/)).toBeInTheDocument();
	},
};

// The badge stays hidden when the display field is off, even if staffing data
// is present — the toggle wins.
export const StaffingBadgeHidden: Story = {
	args: {
		data: {
			title: "Migrate database",
			kind: "task",
			durationDays: 20,
			slackDays: 0,
			critical: true,
			hasEstimate: true,
			status: "not_started",
			progress: 0,
			showStaffing: false,
			staffingPeople: 4,
			staffingDays: 5,
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Migrate database");
		expect(canvas.queryByText(/⚡/)).toBeNull();
	},
};

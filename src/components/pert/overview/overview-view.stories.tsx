import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { computeProjectOverview } from "#/lib/pert/overview";
import type { PertDoc, ProjectCalendar } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { OverviewContent } from "./overview-view";

const est = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 4,
	unit: "day" as const,
};

function sampleDoc(): PertDoc {
	const d = createEmptyPertDoc("Q3 product launch");
	d.tasksById = {
		c1: { id: "c1", kind: "container", title: "Design", parentId: null },
		t1: {
			id: "t1",
			kind: "task",
			title: "Wireframes",
			parentId: "c1",
			estimate: est,
			status: "completed",
		},
		t2: {
			id: "t2",
			kind: "task",
			title: "Visual design",
			parentId: "c1",
			estimate: est,
			status: "in_progress",
			progress: 40,
		},
		t3: {
			id: "t3",
			kind: "task",
			title: "Build API",
			parentId: null,
			estimate: est,
		},
		m1: { id: "m1", kind: "milestone", title: "Launch", parentId: null },
	};
	d.dependenciesById = {
		d1: {
			id: "d1",
			from: { taskId: "t1" },
			to: { taskId: "t2" },
			type: "finish_to_start",
		},
		d2: {
			id: "d2",
			from: { taskId: "t2" },
			to: { taskId: "m1" },
			type: "finish_to_start",
		},
		d3: {
			id: "d3",
			from: { taskId: "t3" },
			to: { taskId: "m1" },
			type: "finish_to_start",
		},
	};
	return d;
}

const DOC = sampleDoc();
const CALENDAR: ProjectCalendar = {
	startDate: "2026-06-01",
	workingDays: [1, 2, 3, 4, 5],
};

const meta: Meta<typeof OverviewContent> = {
	title: "PERT/Overview/OverviewContent",
	component: OverviewContent,
	parameters: { layout: "fullscreen" },
	args: {
		title: "Q3 product launch",
		description: "Ship the new dashboard to GA by end of Q3.",
		doc: DOC,
		overview: computeProjectOverview(DOC),
		readOnly: false,
		metaSaving: false,
		onSaveMeta: fn(),
		calendarInitial: CALENDAR,
		onSaveCalendar: fn(),
		summaryState: { status: "idle" },
		onSummarize: fn(),
		onNavigate: fn(),
		actions: (
			<span className="text-xs text-muted-foreground">
				[export / share / edit / branch / delete]
			</span>
		),
	},
	decorators: [
		(Story) => (
			<div className="h-screen bg-background">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof OverviewContent>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		// Jump-off cards navigate.
		await userEvent.click(await canvas.findByTestId("overview-jump-timeline"));
		expect(args.onNavigate).toHaveBeenCalledWith("timeline");
	},
};

export const EditingDescription: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByTestId("overview-description-edit-button"),
		);
		const input = await canvas.findByTestId("overview-title-input");
		await userEvent.clear(input);
		await userEvent.type(input, "Renamed project");
		await userEvent.click(
			await canvas.findByTestId("overview-description-save"),
		);
		expect(args.onSaveMeta).toHaveBeenCalledWith({
			title: "Renamed project",
			description: "Ship the new dashboard to GA by end of Q3.",
		});
	},
};

export const NoDescription: Story = {
	args: { description: null },
};

export const ReadOnly: Story = {
	args: { readOnly: true, description: null },
};

export const CycleDetected: Story = {
	args: {
		overview: {
			...computeProjectOverview(DOC),
			schedule: { ok: false, cycle: ["t1", "t2"] },
		},
	},
};

export const SummaryLoading: Story = {
	args: { summaryState: { status: "loading" } },
};

export const SummaryDone: Story = {
	args: {
		summaryState: {
			status: "done",
			text: "A small launch plan: 2 tasks, 1 milestone across one design container. Roughly on track with one task in progress.\n\nRisks:\n- Build API is unscheduled work feeding the launch milestone.\n- Visual design is the current bottleneck on the critical path.",
		},
	},
};

export const SummaryError: Story = {
	args: {
		summaryState: {
			status: "error",
			message: "No AI provider is configured on the server.",
		},
	},
};

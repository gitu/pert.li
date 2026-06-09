import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { computeProjectOverview } from "#/lib/pert/overview";
import { computeSchedule } from "#/lib/pert/schedule";
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
	d.groupsById = {
		g1: { id: "g1", name: "Design", parentGroupId: null, order: 0 },
	};
	d.tasksById = {
		t1: {
			id: "t1",
			kind: "task",
			title: "Wireframes",
			groupId: "g1",
			estimate: est,
			status: "completed",
		},
		t2: {
			id: "t2",
			kind: "task",
			title: "Visual design",
			groupId: "g1",
			estimate: est,
			status: "in_progress",
			progress: 40,
		},
		t3: {
			id: "t3",
			kind: "task",
			title: "Build API",
			estimate: est,
		},
		m1: { id: "m1", kind: "milestone", title: "Launch" },
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
const DOC_SCHEDULE = (() => {
	const r = computeSchedule(DOC);
	return r.ok ? r.schedule : null;
})();
const CALENDAR: ProjectCalendar = {
	startDate: "2026-06-01",
	workingDays: [1, 2, 3, 4, 5],
};

const meta: Meta<typeof OverviewContent> = {
	title: "PERT/Overview/OverviewContent",
	component: OverviewContent,
	// The embedded Monte Carlo forecast runs an artificial 1–2s "calculating"
	// timer, so the screenshot can land on either the spinner or the result —
	// non-deterministic. Skip pixel-diffing; play functions still run. The
	// forecast's own visual coverage lives in MonteCarloForecast stories.
	tags: ["no-screenshot-diff"],
	parameters: { layout: "fullscreen" },
	args: {
		title: "Q3 product launch",
		description: "Ship the new dashboard to GA by end of Q3.",
		doc: DOC,
		schedule: DOC_SCHEDULE,
		overview: computeProjectOverview(DOC),
		readOnly: false,
		metaSaving: false,
		onSaveMeta: fn(),
		calendarInitial: CALENDAR,
		onSaveCalendar: fn(),
		issueTrackerInitial: { urlTemplate: "" },
		onSaveIssueTracker: fn(),
		summaryState: { status: "idle" },
		onSummarize: fn(),
		onNavigate: fn(),
		onSelectGroup: fn(),
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

// The Groups section lists every group with its rollup and drills in on click.
export const GroupsSection: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const section = await canvas.findByTestId("overview-groups");
		expect(section.textContent).toContain("Design");
		await userEvent.click(await canvas.findByTestId("overview-group-g1"));
		expect(args.onSelectGroup).toHaveBeenCalledWith("g1");
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

// Expanding the Issue tracker panel reveals the URL-template form, which
// emits the config to the parent on save.
export const IssueTrackerPanel: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("issue-tracker-toggle"));
		// `{{` types a literal `{` (userEvent treats `{` as a key delimiter).
		await userEvent.type(
			await canvas.findByTestId("tracker-template-input"),
			"https://acme.atlassian.net/browse/{{key}",
		);
		await userEvent.click(await canvas.findByTestId("tracker-save"));
		expect(args.onSaveIssueTracker).toHaveBeenCalledWith({
			urlTemplate: "https://acme.atlassian.net/browse/{key}",
			name: undefined,
		});
	},
};

// Read-only (a view-share recipient): the presentational shell suppresses
// every edit affordance it owns. The title's Edit button is gone, the AI
// summary's regenerate action is disabled (the server fn is session-gated),
// and the calendar editor is replaced by a switch-to-edit note.
export const ReadOnly: Story = {
	args: { readOnly: true, description: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// No inline description editing.
		expect(canvas.queryByTestId("overview-description-edit-button")).toBeNull();
		// The summary is read-only: the regenerate action is disabled, so an
		// anonymous viewer can't trigger the session-gated server fn.
		await expect(
			await canvas.findByTestId("overview-ai-summarize"),
		).toBeDisabled();
		// Calendar settings (the calculation basis) are collapsed by default;
		// expanding them shows the read-only note instead of the editor.
		await userEvent.click(await canvas.findByTestId("calendar-basis-toggle"));
		await expect(
			canvas.getByText(/switch to edit mode to change the project calendar/i),
		).toBeVisible();
	},
};

// The Calendar & scheduling section leads with the finish-date forecast; the
// calendar form (the calculation basis) is collapsed behind a toggle and only
// mounts once expanded. After that first mount it stays mounted (just hidden)
// so collapsing mid-edit doesn't discard unsaved edits.
export const CalendarBasisCollapsed: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const toggle = await canvas.findByTestId("calendar-basis-toggle");
		// Forecast is present up front; the calendar editor is not mounted yet.
		await canvas.findByTestId("monte-carlo-forecast");
		expect(canvas.queryByTestId("calendar-start-input")).toBeNull();
		// Expanding the calculation basis reveals the calendar form.
		await userEvent.click(toggle);
		await expect(
			await canvas.findByTestId("calendar-start-input"),
		).toBeVisible();
		// Collapsing keeps the form mounted (so edits survive) but hides it.
		await userEvent.click(toggle);
		await expect(canvas.getByTestId("calendar-start-input")).not.toBeVisible();
		// Re-expanding shows the same (still-mounted) form.
		await userEvent.click(toggle);
		await expect(canvas.getByTestId("calendar-start-input")).toBeVisible();
	},
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
			text: "A small launch plan: 2 tasks, 1 milestone across one design group. Roughly on track with one task in progress.\n\nRisks:\n- Build API is unscheduled work feeding the launch milestone.\n- Visual design is the current bottleneck on the critical path.",
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

// Fully-populated dashboard: header actions, the compact Explore strip up top,
// the stats band, and both columns of the lg grid (summary on the left, calendar
// on the right). The test-runner renders at a wide viewport, so this exercises
// the two-column layout the narrower default stories don't.
export const WideDashboard: Story = {
	args: {
		summaryState: {
			status: "done",
			text: "Q3 product launch — 3 tasks and 1 milestone across one design group. One task is complete and one is in progress, so the plan is roughly a third of the way done.\n\nRisks:\n- Build API is unscheduled work feeding the launch milestone.\n- Visual design is the current bottleneck on the critical path.",
		},
	},
};

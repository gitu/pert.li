import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { resolveScheduling } from "#/lib/pert/resolve-scheduling";
import type { PertDoc, ProjectCalendar } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { ProjectCalendarForm } from "./project-calendar-form";

const est = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 4,
	unit: "day" as const,
};

function sampleDoc(): PertDoc {
	const d = createEmptyPertDoc("Q3 product launch");
	d.tasksById = {
		t1: { id: "t1", kind: "task", title: "Wireframes", estimate: est },
		t2: { id: "t2", kind: "task", title: "Build API", estimate: est },
	};
	return d;
}

const CALENDAR: ProjectCalendar = {
	startDate: "2026-06-01",
	workingDays: [1, 2, 3, 4, 5],
};

const TEAM_CALENDAR: ProjectCalendar = {
	startDate: "2026-06-01",
	workingDays: [1, 2, 3, 4, 5],
	allocationMode: "team",
	team: { peopleCount: 1, availabilityPct: 50 },
};

const meta: Meta<typeof ProjectCalendarForm> = {
	title: "PERT/ProjectCalendarForm",
	component: ProjectCalendarForm,
	args: {
		initial: CALENDAR,
		schedulingInitial: resolveScheduling(undefined),
		doc: sampleDoc(),
		onCancel: fn(),
		onSave: fn(),
	},
	decorators: [
		(Story) => (
			<div className="max-w-md rounded-md border bg-card/40">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof ProjectCalendarForm>;

// Freshly seeded form reads as clean.
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("calendar-clean")).toBeVisible();
		expect(canvas.queryByTestId("calendar-dirty")).toBeNull();
	},
};

// Editing any field flips the footer to "Unsaved changes".
export const Dirty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("calendar-clean")).toBeVisible();
		// Toggle Saturday on — now diverges from the seeded working days.
		await userEvent.click(await canvas.findByTestId("calendar-day-6"));
		await expect(await canvas.findByTestId("calendar-dirty")).toBeVisible();
		expect(canvas.queryByTestId("calendar-clean")).toBeNull();
	},
};

// Team-capacity mode exposes the People/Availability inputs plus the
// effort-vs-duration estimate-basis toggle. Defaults to "effort".
export const TeamCapacity: Story = {
	args: { initial: TEAM_CALENDAR },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const basis = await canvas.findByTestId("calendar-estimate-basis");
		await expect(basis).toBeVisible();
		// Default basis is effort.
		await expect(canvas.getByTestId("basis-effort")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		// Switching to duration flips the pressed state and marks the form dirty.
		await userEvent.click(canvas.getByTestId("basis-duration"));
		await expect(canvas.getByTestId("basis-duration")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(await canvas.findByTestId("calendar-dirty")).toBeVisible();
	},
};

// The estimate-basis choice is included in the saved payload.
export const SavesEstimateBasis: Story = {
	args: { initial: TEAM_CALENDAR },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("basis-duration"));
		await userEvent.click(await canvas.findByTestId("calendar-save"));
		expect(args.onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				allocationMode: "team",
				team: expect.objectContaining({ estimateBasis: "duration" }),
			}),
		);
	},
};

// Saving emits the full calendar payload to the parent.
export const Saves: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("calendar-day-6"));
		await userEvent.click(await canvas.findByTestId("calendar-save"));
		expect(args.onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: "2026-06-01",
				workingDays: [1, 2, 3, 4, 5, 6],
				allocationMode: "calendar",
			}),
		);
	},
};

// Switching the schedule basis to most-likely marks the form dirty and is
// carried in the saved payload.
export const SavesMostLikelyBasis: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByTestId("schedule-basis-most-likely"),
		);
		await expect(await canvas.findByTestId("calendar-dirty")).toBeVisible();
		await userEvent.click(await canvas.findByTestId("calendar-save"));
		expect(args.onSave).toHaveBeenCalledWith(
			expect.objectContaining({ basis: "most-likely" }),
		);
	},
};

// Enabling parallel staffing reveals the level + max inputs and is saved.
export const EnablesParallelStaffing: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByTestId("staffing-enabled"));
		await expect(
			await canvas.findByTestId("staffing-level-input"),
		).toBeEnabled();
		await expect(await canvas.findByTestId("staffing-max-input")).toBeEnabled();
		await userEvent.click(await canvas.findByTestId("calendar-save"));
		expect(args.onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				parallelStaffing: expect.objectContaining({ enabled: true }),
			}),
		);
	},
};

// The staffing Level / Max inputs are editable straight away in Calendar-days
// mode (not greyed out behind the Enabled checkbox) — the checkbox only gates
// whether the forecast runs.
export const StaffingInputsEditableByDefault: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// Default scheduling = staffing disabled, yet the inputs are still enabled.
		await expect(
			await canvas.findByTestId("staffing-level-input"),
		).toBeEnabled();
		await expect(await canvas.findByTestId("staffing-max-input")).toBeEnabled();
		expect(
			(await canvas.findByTestId("staffing-enabled")) as HTMLInputElement,
		).not.toBeChecked();
	},
};

// In team-capacity mode the staffing block is disabled with an explanatory note
// (team capacity already models shared staffing).
export const StaffingDisabledUnderTeam: Story = {
	args: { initial: TEAM_CALENDAR },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("staffing-team-note")).toBeVisible();
		expect(
			(await canvas.findByTestId("staffing-enabled")) as HTMLInputElement,
		).toBeDisabled();
	},
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

const meta: Meta<typeof ProjectCalendarForm> = {
	title: "PERT/ProjectCalendarForm",
	component: ProjectCalendarForm,
	args: {
		initial: CALENDAR,
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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { computeSchedule } from "#/lib/pert/schedule";
import type { Estimate, PertDoc } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { OverviewGroups } from "./overview-groups";

// The Overview view hands OverviewGroups a precomputed schedule; mirror that.
function scheduleOf(doc: PertDoc) {
	const r = computeSchedule(doc);
	return r.ok ? r.schedule : null;
}

const est: Estimate = {
	optimistic: 1,
	mostLikely: 2,
	pessimistic: 4,
	unit: "day",
};

function populatedDoc(): PertDoc {
	const d = createEmptyPertDoc("Launch");
	d.groupsById = {
		g1: { id: "g1", name: "Discovery", parentGroupId: null, order: 0 },
		g2: { id: "g2", name: "Design", parentGroupId: "g1", order: 0 },
		g3: { id: "g3", name: "Build", parentGroupId: null, order: 1 },
	};
	d.tasksById = {
		t1: {
			id: "t1",
			kind: "task",
			title: "Interviews",
			groupId: "g1",
			estimate: est,
			status: "completed",
		},
		t2: {
			id: "t2",
			kind: "task",
			title: "Wireframes",
			groupId: "g2",
			estimate: est,
			status: "in_progress",
			progress: 50,
		},
		t3: {
			id: "t3",
			kind: "task",
			title: "API",
			groupId: "g3",
			estimate: est,
		},
	};
	return d;
}

const meta: Meta<typeof OverviewGroups> = {
	title: "PERT/Overview/OverviewGroups",
	component: OverviewGroups,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-3xl">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof OverviewGroups>;

const POPULATED = populatedDoc();
const EMPTY = createEmptyPertDoc("Empty");

export const Populated: Story = {
	args: { doc: POPULATED, schedule: scheduleOf(POPULATED), onSelect: fn() },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		// All three groups are listed, sorted by WBS number.
		await expect(canvas.findByText("Discovery")).resolves.toBeVisible();
		await expect(canvas.findByText("Build")).resolves.toBeVisible();
		await userEvent.click(await canvas.findByTestId("overview-group-g3"));
		expect(args.onSelect).toHaveBeenCalledWith("g3");
	},
};

export const Empty: Story = {
	args: { doc: EMPTY, schedule: scheduleOf(EMPTY), onSelect: fn() },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.findByText(/no groups yet/i)).resolves.toBeVisible();
	},
};

// DISPLAY-SETTINGS: compact layout drops the progress bar (keeping the %) and
// tightens each row.
const COMPACT_DOC: PertDoc = {
	...populatedDoc(),
	display: { overview: { layout: "compact" } },
};

export const CompactLayout: Story = {
	args: { doc: COMPACT_DOC, schedule: scheduleOf(COMPACT_DOC), onSelect: fn() },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const row = await canvas.findByTestId("overview-group-g3");
		expect(row).toHaveAttribute("data-layout", "compact");
		// The progress % still renders, but the bar (a <progress>-like element) is
		// gone in compact mode.
		await expect(
			canvas.findByTestId("overview-group-progress-g3"),
		).resolves.toBeVisible();
	},
};

// DISPLAY-SETTINGS: hide the task-count + duration columns, surface the
// critical-path badge.
const FIELDS_DOC: PertDoc = {
	...populatedDoc(),
	display: {
		overview: {
			fields: { count: false, duration: false, critical: true },
		},
	},
};

export const FieldsCustomized: Story = {
	args: { doc: FIELDS_DOC, schedule: scheduleOf(FIELDS_DOC), onSelect: fn() },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByTestId("overview-group-g3");
		// Count + duration columns are gone; progress stays.
		expect(canvas.queryByTestId("overview-group-count-g3")).toBeNull();
		expect(canvas.queryByTestId("overview-group-duration-g3")).toBeNull();
		await expect(
			canvas.findByTestId("overview-group-progress-g3"),
		).resolves.toBeVisible();
	},
};

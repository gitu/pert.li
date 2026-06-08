import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import type { PertDoc } from "#/lib/pert/types";
import { createEmptyPertDoc } from "#/lib/pert/types";
import { MonteCarloForecastView } from "./monte-carlo-forecast";

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
		t2: { id: "t2", kind: "task", title: "Visual design", estimate: est },
		t3: { id: "t3", kind: "task", title: "Build API", estimate: est },
	};
	return d;
}

const DOC = sampleDoc();

const RESULT: MonteCarloResult = {
	trials: 2000,
	projectFinish: {
		p10: 9,
		p50: 12,
		p90: 17,
		mean: 12.6,
		p50Date: "2026-06-18",
		p90Date: "2026-06-25",
	},
	tasks: {
		t3: {
			taskId: "t3",
			p10: 6,
			p50: 8,
			p90: 11,
			mean: 8.3,
			criticality: 0.92,
			p50Date: "2026-06-12",
			p90Date: "2026-06-17",
		},
		t2: {
			taskId: "t2",
			p10: 8,
			p50: 11,
			p90: 15,
			mean: 11.2,
			criticality: 0.61,
			p50Date: "2026-06-17",
			p90Date: "2026-06-23",
		},
		t1: {
			taskId: "t1",
			p10: 2,
			p50: 3,
			p90: 5,
			mean: 3.1,
			criticality: 0.18,
			p50Date: "2026-06-04",
			p90Date: "2026-06-06",
		},
	},
};

const meta: Meta<typeof MonteCarloForecastView> = {
	title: "PERT/Overview/MonteCarloForecast",
	component: MonteCarloForecastView,
	args: { doc: DOC },
	decorators: [
		(Story) => (
			<div className="max-w-md rounded-md border bg-card/40">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof MonteCarloForecastView>;

export const Calculating: Story = {
	args: { status: "calculating", result: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("mc-calculating")).toBeVisible();
	},
};

export const Ready: Story = {
	args: { status: "ready", result: RESULT },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("mc-result")).toBeVisible();
		// Most-critical task surfaces first, with its criticality percentage.
		const table = await canvas.findByTestId("mc-top-tasks");
		await expect(within(table).getByText("Build API")).toBeVisible();
		await expect(within(table).getByText("92%")).toBeVisible();
	},
};

export const Empty: Story = {
	args: { status: "empty", result: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("mc-empty")).toBeVisible();
	},
};

// A dependency cycle: the sim settles with no result, so we explain rather than
// spin forever.
export const Unavailable: Story = {
	args: { status: "unavailable", result: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByTestId("mc-unavailable")).toBeVisible();
	},
};

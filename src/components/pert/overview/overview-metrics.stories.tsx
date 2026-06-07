import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ProjectOverview } from "#/lib/pert/overview";
import { OverviewMetrics } from "./overview-metrics";

const base: ProjectOverview = {
	taskCount: 24,
	milestoneCount: 4,
	groupCount: 6,
	dependencyCount: 31,
	status: { notStarted: 14, inProgress: 6, completed: 8 },
	progressPct: 38,
	schedule: {
		ok: true,
		durationDays: 47,
		startDate: "2026-06-01",
		finishDate: "2026-08-06",
		criticalCount: 9,
	},
};

const meta: Meta<typeof OverviewMetrics> = {
	title: "PERT/Overview/OverviewMetrics",
	component: OverviewMetrics,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof OverviewMetrics>;

export const Default: Story = { args: { overview: base } };

export const Empty: Story = {
	args: {
		overview: {
			taskCount: 0,
			milestoneCount: 0,
			groupCount: 0,
			dependencyCount: 0,
			status: { notStarted: 0, inProgress: 0, completed: 0 },
			progressPct: 0,
			schedule: {
				ok: true,
				durationDays: 0,
				startDate: "2026-06-01",
				finishDate: "2026-06-01",
				criticalCount: 0,
			},
		},
	},
};

export const CycleDetected: Story = {
	args: {
		overview: {
			...base,
			schedule: { ok: false, cycle: ["t1", "t2", "t3"] },
		},
	},
};

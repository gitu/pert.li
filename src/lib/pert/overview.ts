// Project-level "key figures" for the Overview tab. Pure: derives everything
// from the doc + the existing CPM engine, never writes back. The Overview view
// reads this in a useMemo; the AI-summary digest (overview-digest.ts) consumes
// the same shape so the figures the user sees match what the model is told.

import {
	computeSchedule,
	expected,
	progressFractionOf,
	statusOf,
} from "./schedule";
import type { PertDoc, TaskId } from "./types";

export type ProjectStatusBreakdown = {
	notStarted: number;
	inProgress: number;
	completed: number;
};

// Schedule-derived figures. Unavailable as a block when the graph has a cycle
// (the CPM engine can't lay out a project that depends on itself), so the UI
// can switch to a "fix the cycle first" state instead of showing bogus dates.
export type ProjectScheduleSummary =
	| {
			ok: true;
			durationDays: number;
			startDate: string;
			finishDate: string;
			criticalCount: number;
	  }
	| { ok: false; cycle: TaskId[] };

export type ProjectOverview = {
	taskCount: number;
	milestoneCount: number;
	containerCount: number;
	dependencyCount: number;
	interfaceCount: number;
	// Status + progress roll up over leaf entities (tasks + milestones), the
	// same population rollupContainer uses (kind !== "container").
	status: ProjectStatusBreakdown;
	// 0..100, weighted by expected duration so a half-done long task counts more
	// than a half-done short one. Mirrors rollupContainer's progress weighting.
	progressPct: number;
	schedule: ProjectScheduleSummary;
};

export function computeProjectOverview(doc: PertDoc): ProjectOverview {
	let taskCount = 0;
	let milestoneCount = 0;
	let containerCount = 0;
	const status: ProjectStatusBreakdown = {
		notStarted: 0,
		inProgress: 0,
		completed: 0,
	};
	let weightedProgress = 0;
	let progressWeight = 0;

	for (const task of Object.values(doc.tasksById)) {
		if (task.kind === "container") {
			containerCount += 1;
			continue;
		}
		if (task.kind === "milestone") milestoneCount += 1;
		else taskCount += 1;

		const s = statusOf(task);
		if (s === "completed") status.completed += 1;
		else if (s === "in_progress") status.inProgress += 1;
		else status.notStarted += 1;

		// Compute progress straight from the task (not the schedule) so it stays
		// available even when a cycle blocks the schedule. Weight by expected
		// duration; milestones / estimate-less tasks fall back to weight 1.
		const exp = expected(task.estimate);
		const w = exp > 0 ? exp : 1;
		weightedProgress += progressFractionOf(task) * 100 * w;
		progressWeight += w;
	}

	const dependencyCount = Object.keys(doc.dependenciesById).length;
	let interfaceCount = 0;
	for (const bucket of Object.values(doc.interfacesByContainerId)) {
		interfaceCount += Object.keys(bucket).length;
	}

	const progressPct =
		progressWeight > 0 ? weightedProgress / progressWeight : 0;

	const result = computeSchedule(doc);
	const schedule: ProjectScheduleSummary = result.ok
		? {
				ok: true,
				durationDays: result.schedule.projectDuration,
				startDate: result.schedule.projectStartDate,
				finishDate: result.schedule.projectFinishDate,
				criticalCount: result.schedule.criticalTaskIds.length,
			}
		: { ok: false, cycle: result.cycle };

	return {
		taskCount,
		milestoneCount,
		containerCount,
		dependencyCount,
		interfaceCount,
		status,
		progressPct,
		schedule,
	};
}

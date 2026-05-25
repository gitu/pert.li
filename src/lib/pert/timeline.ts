import type { ScheduleResult } from "./schedule";
import type { PertDoc, TaskId, TaskKind } from "./types";

// Pure layout helpers for the Timeline view. The view itself only knows how
// to render a sorted list of lanes — slack / critical / duration come from
// the engine, lane order and the day axis come from here.

export type TimelineLane = {
	taskId: TaskId;
	title: string;
	kind: TaskKind;
	earliestStart: number;
	earliestFinish: number;
	duration: number;
	slack: number;
	critical: boolean;
};

export type TimelineModel = {
	lanes: TimelineLane[];
	projectDuration: number;
	// Inclusive upper bound for the axis. Always ≥ projectDuration and ≥ 1 so
	// an empty / single-milestone doc still renders a usable strip.
	axisMax: number;
	cycle: boolean;
};

export function buildTimelineModel(
	doc: PertDoc,
	scheduleResult: ScheduleResult,
): TimelineModel {
	if (!scheduleResult.ok) {
		return { lanes: [], projectDuration: 0, axisMax: 1, cycle: true };
	}
	const schedule = scheduleResult.schedule;
	const lanes: TimelineLane[] = [];
	for (const task of Object.values(doc.tasksById)) {
		if (task.kind === "container") continue;
		const s = schedule.tasks[task.id];
		if (!s) continue;
		lanes.push({
			taskId: task.id,
			title: task.title || "Untitled",
			kind: task.kind,
			earliestStart: s.earliestStart,
			earliestFinish: s.earliestFinish,
			duration: s.duration,
			slack: s.slack,
			critical: s.critical,
		});
	}
	lanes.sort((a, b) => {
		if (a.earliestStart !== b.earliestStart)
			return a.earliestStart - b.earliestStart;
		if (a.earliestFinish !== b.earliestFinish)
			return a.earliestFinish - b.earliestFinish;
		return a.title.localeCompare(b.title);
	});
	const projectDuration = schedule.projectDuration;
	return {
		lanes,
		projectDuration,
		axisMax: Math.max(projectDuration, 1),
		cycle: false,
	};
}

// Snap floats that are within an epsilon of an integer (e.g. 1.99999998) up
// to the integer — the axis is integer-day labelled and "Day 2" reads
// better than "Day 1.99". Used for tick generation only.
export function timelineTicks(axisMax: number, target: number = 8): number[] {
	if (axisMax <= 0) return [0];
	const stepRaw = axisMax / target;
	const niceSteps = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
	const step =
		niceSteps.find((s) => s >= stepRaw) ?? Math.ceil(stepRaw / 100) * 100;
	const out: number[] = [];
	for (let v = 0; v <= axisMax + 1e-6; v += step) {
		out.push(Math.round(v * 1000) / 1000);
	}
	return out;
}

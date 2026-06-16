import { dayOffsetToDate, workingDaysInclusive } from "./calendar";
import type {
	Dependency,
	DependencyType,
	Estimate,
	EstimateBasis,
	PertDoc,
	Task,
	TaskId,
	TaskStatus,
} from "./types";

// Deterministic Critical Path Method engine. Pure function over the PERT doc;
// callers cache the result with useMemo / TanStack Store. Never written back
// into the Automerge doc.
//
// Scope:
//  - Every task schedules. Groups are organisational only — they add no
//    scheduling constraints; the projection layer rolls their members up.
//  - All four dependency types are honoured.
//  - Lag is applied as additional days on the edge.
//  - Tasks with no estimate are treated as zero-duration (milestone-like).
//
// All durations are expressed in days, regardless of each task's chosen
// estimate unit — `expected()` normalises to days so the schedule is uniform.

export type Schedule = {
	tasks: Record<TaskId, TaskSchedule>;
	projectDuration: number;
	criticalTaskIds: TaskId[];
	projectStartDate: string;
	projectFinishDate: string;
};

export type TaskSchedule = {
	taskId: TaskId;
	// Effective duration used in the forward/backward pass — accounts for
	// status/progress. A completed task is 0; an in-progress task is
	// `expected × (1 − progress/100)`. Use `expected` for the unadjusted PERT
	// value (so the UI can show plan vs. remaining side-by-side).
	duration: number;
	expected: number;
	variance: number;
	earliestStart: number;
	earliestFinish: number;
	latestStart: number;
	latestFinish: number;
	slack: number;
	critical: boolean;
	status: TaskStatus;
	progress: number;
	// Calendar projections. Always present once the doc has any tasks; default
	// to today when the project hasn't set a startDate yet.
	earliestStartDate: string;
	earliestFinishDate: string;
	latestStartDate: string;
	latestFinishDate: string;
};

export type ScheduleResult =
	| { ok: true; schedule: Schedule }
	| { ok: false; reason: "cycle"; cycle: TaskId[] };

const EPSILON = 1e-9;

const UNIT_TO_DAYS: Record<Estimate["unit"], number> = {
	hour: 1 / 24,
	day: 1,
	week: 7,
};

export function expected(estimate: Estimate | undefined): number {
	if (!estimate) return 0;
	const raw =
		(estimate.optimistic + 4 * estimate.mostLikely + estimate.pessimistic) / 6;
	return raw * UNIT_TO_DAYS[estimate.unit];
}

export function variance(estimate: Estimate | undefined): number {
	if (!estimate) return 0;
	const spread = (estimate.pessimistic - estimate.optimistic) / 6;
	return (spread * UNIT_TO_DAYS[estimate.unit]) ** 2;
}

export function durationOf(task: Task): number {
	if (task.kind === "milestone") return 0;
	return expected(task.estimate);
}

export function statusOf(task: Task): TaskStatus {
	return task.status ?? "not_started";
}

export function progressFractionOf(task: Task): number {
	const status = statusOf(task);
	if (status === "completed") return 1;
	if (status === "not_started") return 0;
	const raw = task.progress ?? 0;
	if (raw <= 0) return 0;
	if (raw >= 100) return 1;
	return raw / 100;
}

// Effective remaining duration the CPM math should use. Completed work is
// burned down to zero; in-progress work shrinks by the reported fraction. The
// UI keeps `expected` separately so it can render plan vs. remaining.
export function effectiveDurationOf(task: Task): number {
	const planned = durationOf(task);
	if (planned <= 0) return 0;
	const status = statusOf(task);
	if (status === "completed") return 0;
	const remaining = 1 - progressFractionOf(task);
	return planned * remaining;
}

// Effective variance — completed and in-progress work has reduced uncertainty.
// We scale by the same remaining fraction so a half-done task contributes half
// the variance into the Monte Carlo sums.
export function effectiveVarianceOf(task: Task): number {
	const planned = variance(task.estimate);
	if (planned <= 0) return 0;
	const status = statusOf(task);
	if (status === "completed") return 0;
	const remaining = 1 - progressFractionOf(task);
	return planned * remaining;
}

type SchedulableDep = {
	from: TaskId;
	to: TaskId;
	type: DependencyType;
	lag: number;
};

function collectSchedulable(doc: PertDoc): {
	taskIds: TaskId[];
	tasks: Record<TaskId, Task>;
	deps: SchedulableDep[];
	successors: Record<TaskId, SchedulableDep[]>;
	predecessors: Record<TaskId, SchedulableDep[]>;
} {
	const tasks: Record<TaskId, Task> = {};
	const taskIds: TaskId[] = [];
	for (const [id, task] of Object.entries(doc.tasksById)) {
		tasks[id] = task;
		taskIds.push(id);
	}

	const deps: SchedulableDep[] = [];
	for (const dep of Object.values(doc.dependenciesById)) {
		const edge = toSchedulable(dep);
		if (!edge) continue;
		if (!tasks[edge.from] || !tasks[edge.to]) continue;
		if (edge.from === edge.to) continue; // self-loop is degenerate; ignore
		deps.push(edge);
	}

	const successors: Record<TaskId, SchedulableDep[]> = {};
	const predecessors: Record<TaskId, SchedulableDep[]> = {};
	for (const id of taskIds) {
		successors[id] = [];
		predecessors[id] = [];
	}
	for (const dep of deps) {
		successors[dep.from].push(dep);
		predecessors[dep.to].push(dep);
	}

	return { taskIds, tasks, deps, successors, predecessors };
}

function toSchedulable(dep: Dependency): SchedulableDep | null {
	const fromId = dep.from.taskId;
	const toId = dep.to.taskId;
	if (!fromId || !toId) return null;
	return { from: fromId, to: toId, type: dep.type, lag: dep.lagDays ?? 0 };
}

// Tarjan-style DFS with three colours. Returns the first cycle reached as a
// path [a, b, ..., a] so the UI can highlight it.
function findCycle(
	taskIds: TaskId[],
	successors: Record<TaskId, SchedulableDep[]>,
): { order: TaskId[] } | { cycle: TaskId[] } {
	const WHITE = 0;
	const GREY = 1;
	const BLACK = 2;
	const colour: Record<TaskId, number> = {};
	for (const id of taskIds) colour[id] = WHITE;
	const order: TaskId[] = [];
	const stack: TaskId[] = [];

	function visit(node: TaskId): TaskId[] | null {
		colour[node] = GREY;
		stack.push(node);
		for (const edge of successors[node]) {
			const next = edge.to;
			if (colour[next] === WHITE) {
				const cyc = visit(next);
				if (cyc) return cyc;
			} else if (colour[next] === GREY) {
				const startIdx = stack.indexOf(next);
				return [...stack.slice(startIdx), next];
			}
		}
		stack.pop();
		colour[node] = BLACK;
		order.push(node);
		return null;
	}

	for (const id of taskIds) {
		if (colour[id] !== WHITE) continue;
		const cyc = visit(id);
		if (cyc) return { cycle: cyc };
	}

	order.reverse(); // post-order → reverse = topological order
	return { order };
}

export function computeSchedule(doc: PertDoc): ScheduleResult {
	const { taskIds, tasks, successors, predecessors } = collectSchedulable(doc);

	const cycleCheck = findCycle(taskIds, successors);
	if ("cycle" in cycleCheck) {
		return { ok: false, reason: "cycle", cycle: cycleCheck.cycle };
	}
	const order = cycleCheck.order;

	const plannedDuration: Record<TaskId, number> = {};
	const baselineDuration: Record<TaskId, number> = {};
	for (const id of taskIds) {
		baselineDuration[id] = effectiveDurationOf(tasks[id]);
		plannedDuration[id] = durationOf(tasks[id]);
	}

	// Two-pass: first run the unconstrained CPM, then if the project is on a
	// team-capacity calendar, scale each task's duration by the worst-case
	// "equal allocation across concurrent peers" rule and re-run. The peer
	// count comes from the baseline ES/EF windows.
	let duration = baselineDuration;
	const teamCapacity = teamCapacityPerDay(doc);
	if (teamCapacity > 0) {
		const baseline = runForwardBackward(
			taskIds,
			order,
			successors,
			predecessors,
			baselineDuration,
		);
		duration = scaleForTeamCapacity(
			taskIds,
			baselineDuration,
			baseline.es,
			baseline.ef,
			teamCapacity,
			doc.calendar?.team?.estimateBasis ?? "effort",
		);
	}

	const { es, ef, ls, lf, projectDuration } = runForwardBackward(
		taskIds,
		order,
		successors,
		predecessors,
		duration,
	);

	const tasksOut: Record<TaskId, TaskSchedule> = {};
	const critical: TaskId[] = [];
	const calendar = doc.calendar;
	for (const id of taskIds) {
		const slack = ls[id] - es[id];
		const isCritical = Math.abs(slack) <= EPSILON;
		tasksOut[id] = {
			taskId: id,
			duration: duration[id],
			expected: plannedDuration[id],
			variance: variance(tasks[id].estimate),
			earliestStart: es[id],
			earliestFinish: ef[id],
			latestStart: ls[id],
			latestFinish: lf[id],
			slack,
			critical: isCritical,
			status: statusOf(tasks[id]),
			progress: Math.round(progressFractionOf(tasks[id]) * 100),
			earliestStartDate: dayOffsetToDate(es[id], calendar),
			earliestFinishDate: dayOffsetToDate(ef[id], calendar),
			latestStartDate: dayOffsetToDate(ls[id], calendar),
			latestFinishDate: dayOffsetToDate(lf[id], calendar),
		};
		if (isCritical) critical.push(id);
	}

	return {
		ok: true,
		schedule: {
			tasks: tasksOut,
			projectDuration,
			criticalTaskIds: critical,
			projectStartDate: dayOffsetToDate(0, calendar),
			projectFinishDate: dayOffsetToDate(projectDuration, calendar),
		},
	};
}

// Lower bound on the successor's ES, given an incoming edge from a settled
// predecessor (ES/EF already known) plus this task's own duration.
function startConstraint(
	edge: SchedulableDep,
	es: Record<TaskId, number>,
	ef: Record<TaskId, number>,
	successorDuration: number,
): number {
	switch (edge.type) {
		case "finish_to_start":
			return ef[edge.from] + edge.lag;
		case "start_to_start":
			return es[edge.from] + edge.lag;
		case "finish_to_finish":
			return ef[edge.from] + edge.lag - successorDuration;
		case "start_to_finish":
			return es[edge.from] + edge.lag - successorDuration;
	}
}

// Upper bound on the predecessor's LF, given an outgoing edge to a settled
// successor (LS/LF already known) plus this task's own duration.
function finishConstraint(
	edge: SchedulableDep,
	successorLs: number,
	successorLf: number,
	predecessorDuration: number,
): number {
	switch (edge.type) {
		case "finish_to_start":
			return successorLs - edge.lag;
		case "start_to_start":
			return successorLs - edge.lag + predecessorDuration;
		case "finish_to_finish":
			return successorLf - edge.lag;
		case "start_to_finish":
			return successorLf - edge.lag + predecessorDuration;
	}
}

// Single forward + backward CPM pass given a duration map. Returns the four
// schedule fields plus the project duration. No team/calendar awareness here
// — caller picks which duration map to feed in.
function runForwardBackward(
	taskIds: TaskId[],
	order: TaskId[],
	successors: Record<TaskId, SchedulableDep[]>,
	predecessors: Record<TaskId, SchedulableDep[]>,
	duration: Record<TaskId, number>,
): {
	es: Record<TaskId, number>;
	ef: Record<TaskId, number>;
	ls: Record<TaskId, number>;
	lf: Record<TaskId, number>;
	projectDuration: number;
} {
	const es: Record<TaskId, number> = {};
	const ef: Record<TaskId, number> = {};
	for (const id of order) {
		let earliestStart = 0;
		for (const edge of predecessors[id]) {
			const candidate = startConstraint(edge, es, ef, duration[id]);
			if (candidate > earliestStart) earliestStart = candidate;
		}
		es[id] = earliestStart;
		ef[id] = earliestStart + duration[id];
	}
	let projectDuration = 0;
	for (const id of taskIds)
		if (ef[id] > projectDuration) projectDuration = ef[id];

	const ls: Record<TaskId, number> = {};
	const lf: Record<TaskId, number> = {};
	const reverse = [...order].reverse();
	for (const id of reverse) {
		const outgoing = successors[id];
		let latestFinish = projectDuration;
		if (outgoing.length > 0) {
			latestFinish = Number.POSITIVE_INFINITY;
			for (const edge of outgoing) {
				const candidate = finishConstraint(
					edge,
					ls[edge.to],
					lf[edge.to],
					duration[id],
				);
				if (candidate < latestFinish) latestFinish = candidate;
			}
		}
		lf[id] = latestFinish;
		ls[id] = latestFinish - duration[id];
	}
	return { es, ef, ls, lf, projectDuration };
}

// Observed PD/day delivered by the team across completed tasks. Returns null
// when no completed task has both actualStart and actualFinish (no signal yet)
// or the elapsed working-day count is zero.
//
// Caveats: the "PD delivered" is the *planned* expected duration, not real
// time-tracking. Good enough for a velocity estimate; not an accurate billing
// figure. Completed tasks without actualStart/Finish are skipped — they don't
// tell us how long they took.
export type HistoricCapacity = {
	deliveredPd: number;
	elapsedWorkingDays: number;
	perDay: number;
	sampleCount: number;
};

export function historicCapacityPerDay(doc: PertDoc): HistoricCapacity | null {
	let deliveredPd = 0;
	let elapsedWorkingDays = 0;
	let sampleCount = 0;
	for (const task of Object.values(doc.tasksById)) {
		if (task.kind !== "task") continue;
		if (statusOf(task) !== "completed") continue;
		if (!task.actualStart || !task.actualFinish) continue;
		const pd = expected(task.estimate);
		if (pd <= 0) continue;
		const elapsed = workingDaysInclusive(
			task.actualStart,
			task.actualFinish,
			doc.calendar,
		);
		if (elapsed <= 0) continue;
		deliveredPd += pd;
		elapsedWorkingDays += elapsed;
		sampleCount += 1;
	}
	if (sampleCount === 0 || elapsedWorkingDays <= 0) return null;
	return {
		deliveredPd,
		elapsedWorkingDays,
		perDay: deliveredPd / elapsedWorkingDays,
		sampleCount,
	};
}

// Resolves the calendar's team capacity to "person-days available per
// project day". Returns 0 when team mode is off or capacity is zero — the
// schedule then falls back to the unconstrained CPM.
//
// When the calendar's team has `useHistoric: true` and the project has
// usable history, the observed PD/day overrides the configured value.
export function teamCapacityPerDay(doc: PertDoc): number {
	const cal = doc.calendar;
	if (!cal || cal.allocationMode !== "team" || !cal.team) return 0;
	if (cal.team.useHistoric) {
		const historic = historicCapacityPerDay(doc);
		if (historic && historic.perDay > 0) return historic.perDay;
	}
	const pd =
		Math.max(0, cal.team.peopleCount) *
		(Math.max(0, Math.min(100, cal.team.availabilityPct)) / 100);
	return pd > 0 ? pd : 0;
}

// "Worst-case equal allocation" duration scaling. For each task, count how
// many other tasks share its baseline [ES, EF) window — that's its peer set.
//
// We use the MAX overlap during the window rather than averaging — that's
// what "worst case" means: assume the team got crowded at the bottleneck and
// stayed crowded for the whole task. Tasks with zero baseline duration
// (completed, milestones, missing estimate) keep their zero.
//
// `basis` picks how the estimate is read:
//   • "effort"   — estimate is person-days. Capacity per task is
//                  `capacity / peers`, so E person-days take `E * peers /
//                  capacity` calendar days. A lone task with half a person
//                  takes 2× as long.
//   • "duration" — estimate is the calendar duration one assignee achieves.
//                  Capacity caps parallelism but a lone task is never stretched
//                  by an under-one-person team: factor = `max(1, peers /
//                  max(capacity, 1))`. Only genuine over-subscription (more
//                  concurrent tasks than the team can staff) stretches it.
function scaleForTeamCapacity(
	taskIds: TaskId[],
	baseline: Record<TaskId, number>,
	es: Record<TaskId, number>,
	ef: Record<TaskId, number>,
	capacityPerDay: number,
	basis: EstimateBasis,
): Record<TaskId, number> {
	const scaled: Record<TaskId, number> = {};
	for (const id of taskIds) {
		const dur = baseline[id];
		if (dur <= 0) {
			scaled[id] = 0;
			continue;
		}
		let peers = 1;
		for (const other of taskIds) {
			if (other === id) continue;
			if (baseline[other] <= 0) continue;
			// Overlap on [a.es, a.ef) ∩ [b.es, b.ef) — half-open, so touching
			// windows don't count as concurrent.
			if (es[other] < ef[id] && ef[other] > es[id]) peers += 1;
		}
		const factor =
			basis === "duration"
				? Math.max(1, peers / Math.max(capacityPerDay, 1))
				: peers / capacityPerDay;
		scaled[id] = dur * factor;
	}
	return scaled;
}

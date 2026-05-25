import type {
	Dependency,
	DependencyType,
	Estimate,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// Deterministic Critical Path Method engine. Pure function over the PERT doc;
// callers cache the result with useMemo / TanStack Store. Never written back
// into the Automerge doc.
//
// Scope (Phase 3):
//  - Leaf tasks only (kind !== "container"). Containers and interface-routed
//    edges land in Phase 5 (projection).
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
};

export type TaskSchedule = {
	taskId: TaskId;
	duration: number;
	expected: number;
	variance: number;
	earliestStart: number;
	earliestFinish: number;
	latestStart: number;
	latestFinish: number;
	slack: number;
	critical: boolean;
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
	if (task.kind === "container") return 0;
	return expected(task.estimate);
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
		if (task.kind === "container") continue;
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
	if (!fromId || !toId) return null; // interface-routed edges arrive in Phase 5
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

	const duration: Record<TaskId, number> = {};
	const es: Record<TaskId, number> = {};
	const ef: Record<TaskId, number> = {};
	for (const id of taskIds) duration[id] = durationOf(tasks[id]);

	// Forward pass.
	for (const id of order) {
		const incoming = predecessors[id];
		let earliestStart = 0;
		for (const edge of incoming) {
			const candidate = startConstraint(edge, es, ef, duration[id]);
			if (candidate > earliestStart) earliestStart = candidate;
		}
		es[id] = earliestStart;
		ef[id] = earliestStart + duration[id];
	}

	const projectDuration = order.reduce(
		(max, id) => (ef[id] > max ? ef[id] : max),
		0,
	);

	// Backward pass over reverse topo order.
	const lf: Record<TaskId, number> = {};
	const ls: Record<TaskId, number> = {};
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

	const tasksOut: Record<TaskId, TaskSchedule> = {};
	const critical: TaskId[] = [];
	for (const id of taskIds) {
		const slack = ls[id] - es[id];
		const isCritical = Math.abs(slack) <= EPSILON;
		tasksOut[id] = {
			taskId: id,
			duration: duration[id],
			expected: duration[id],
			variance: variance(tasks[id].estimate),
			earliestStart: es[id],
			earliestFinish: ef[id],
			latestStart: ls[id],
			latestFinish: lf[id],
			slack,
			critical: isCritical,
		};
		if (isCritical) critical.push(id);
	}

	return {
		ok: true,
		schedule: {
			tasks: tasksOut,
			projectDuration,
			criticalTaskIds: critical,
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

import { dayOffsetToDate } from "./calendar";
import {
	expected as expectedDays,
	progressFractionOf,
	statusOf,
	teamCapacityPerDay,
} from "./schedule";
import type {
	Dependency,
	DependencyType,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// Pure Monte Carlo simulator. Samples each leaf task's duration from a
// Beta-PERT distribution N times, recomputes the longest path per trial, and
// accumulates per-task finish times plus the count of trials each task was on
// the critical path. The output is read-only — never written to the Automerge
// doc — and is what the worker wrapper returns to the UI.
//
// Why Beta-PERT?
//   • It is the canonical distribution for three-point estimates.
//   • Bounded on [optimistic, pessimistic] → no negative durations.
//   • Skewed toward `mostLikely`, matching what PMs expect when they fill in
//     the three numbers (vs. a symmetric triangular fit).
//
// Status semantics:
//   • completed tasks sample as 0 with no variance.
//   • in_progress tasks sample on the *remaining* fraction of duration — the
//     burn-down has already happened, only the rest is uncertain.

export type MonteCarloOptions = {
	trials?: number;
	seed?: number;
	// Beta-PERT "lambda" shape parameter. 4 is the standard textbook value;
	// larger values concentrate samples around `mostLikely`.
	lambda?: number;
};

export type MonteCarloTask = {
	taskId: TaskId;
	// Finish-time percentiles in project days (0 = project start).
	p10: number;
	p50: number;
	p90: number;
	mean: number;
	// Share of trials where this task was on the trial's critical path.
	criticality: number;
	// Convenience date projections when the doc has a calendar.
	p50Date: string;
	p90Date: string;
};

export type MonteCarloResult = {
	trials: number;
	projectFinish: {
		p10: number;
		p50: number;
		p90: number;
		mean: number;
		p50Date: string;
		p90Date: string;
	};
	tasks: Record<TaskId, MonteCarloTask>;
};

export const DEFAULT_TRIALS = 2000;
const DEFAULT_LAMBDA = 4;

// Deterministic PRNG so tests are stable across runs. mulberry32 is fine for
// simulation — it is not cryptographic and we don't claim it is.
function makeRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Marsaglia–Tsang Gamma sampler for shape ≥ 1; tiny shape paths use the
// boost-from-Gamma(α+1) trick. Returns a single sample from Gamma(shape, 1).
function gammaSample(shape: number, rand: () => number): number {
	if (shape < 1) {
		const g = gammaSample(shape + 1, rand);
		return g * rand() ** (1 / shape);
	}
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	while (true) {
		let x: number;
		let v: number;
		do {
			// Box–Muller for a standard normal.
			const u1 = Math.max(rand(), 1e-12);
			const u2 = rand();
			x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = rand();
		const xx = x * x;
		if (u < 1 - 0.0331 * xx * xx) return d * v;
		if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v;
	}
}

function betaSample(alpha: number, beta: number, rand: () => number): number {
	const x = gammaSample(alpha, rand);
	const y = gammaSample(beta, rand);
	return x / (x + y);
}

// Sample one trial duration for a task. Honours status (completed → 0) and
// progress (in_progress → scale remaining slice).
export function sampleTaskDuration(
	task: Task,
	rand: () => number,
	lambda = DEFAULT_LAMBDA,
): number {
	if (task.kind !== "task") return 0;
	const est = task.estimate;
	if (!est) return 0;
	const status = statusOf(task);
	if (status === "completed") return 0;

	const aDays = est.optimistic * UNIT_TO_DAYS[est.unit];
	const mDays = est.mostLikely * UNIT_TO_DAYS[est.unit];
	const bDays = est.pessimistic * UNIT_TO_DAYS[est.unit];

	let raw: number;
	if (bDays <= aDays) {
		raw = aDays;
	} else {
		// Standard Beta-PERT parameterisation.
		const alpha = 1 + (lambda * (mDays - aDays)) / (bDays - aDays);
		const betaShape = 1 + (lambda * (bDays - mDays)) / (bDays - aDays);
		const x = betaSample(alpha, betaShape, rand);
		raw = aDays + x * (bDays - aDays);
	}

	const remaining = 1 - progressFractionOf(task);
	return Math.max(0, raw * remaining);
}

const UNIT_TO_DAYS = {
	hour: 1 / 24,
	day: 1,
	week: 7,
} as const;

type Edge = {
	from: TaskId;
	to: TaskId;
	type: DependencyType;
	lag: number;
};

type SimGraph = {
	taskIds: TaskId[];
	tasks: Record<TaskId, Task>;
	order: TaskId[]; // topological
	predecessors: Record<TaskId, Edge[]>;
	successors: Record<TaskId, Edge[]>;
};

function toEdge(dep: Dependency): Edge | null {
	const from = dep.from.taskId;
	const to = dep.to.taskId;
	if (!from || !to) return null;
	return { from, to, type: dep.type, lag: dep.lagDays ?? 0 };
}

// Topological order over leaf tasks only. We assume the doc is acyclic — the
// CPM engine has already proved that before the worker runs.
function buildGraph(doc: PertDoc): SimGraph | null {
	const tasks: Record<TaskId, Task> = {};
	const taskIds: TaskId[] = [];
	for (const [id, t] of Object.entries(doc.tasksById)) {
		if (t.kind === "container") continue;
		tasks[id] = t;
		taskIds.push(id);
	}
	const edges: Edge[] = [];
	for (const dep of Object.values(doc.dependenciesById)) {
		const e = toEdge(dep);
		if (!e) continue;
		if (!tasks[e.from] || !tasks[e.to]) continue;
		if (e.from === e.to) continue;
		edges.push(e);
	}

	const predecessors: Record<TaskId, Edge[]> = {};
	const successors: Record<TaskId, Edge[]> = {};
	for (const id of taskIds) {
		predecessors[id] = [];
		successors[id] = [];
	}
	for (const e of edges) {
		predecessors[e.to].push(e);
		successors[e.from].push(e);
	}

	// Kahn's algorithm. Returns null on cycle (caller should fall back to the
	// deterministic engine's cycle output).
	const indegree: Record<TaskId, number> = {};
	for (const id of taskIds) indegree[id] = predecessors[id].length;
	const queue: TaskId[] = taskIds.filter((id) => indegree[id] === 0);
	const order: TaskId[] = [];
	while (queue.length > 0) {
		const id = queue.shift() as TaskId;
		order.push(id);
		for (const e of successors[id]) {
			indegree[e.to] -= 1;
			if (indegree[e.to] === 0) queue.push(e.to);
		}
	}
	if (order.length !== taskIds.length) return null;
	return { taskIds, tasks, order, predecessors, successors };
}

function startFrom(
	edge: Edge,
	es: Record<TaskId, number>,
	ef: Record<TaskId, number>,
	dur: number,
): number {
	switch (edge.type) {
		case "finish_to_start":
			return ef[edge.from] + edge.lag;
		case "start_to_start":
			return es[edge.from] + edge.lag;
		case "finish_to_finish":
			return ef[edge.from] + edge.lag - dur;
		case "start_to_finish":
			return es[edge.from] + edge.lag - dur;
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function runMonteCarlo(
	doc: PertDoc,
	options: MonteCarloOptions = {},
): MonteCarloResult | null {
	const graph = buildGraph(doc);
	if (!graph) return null;
	const trials = Math.max(1, Math.floor(options.trials ?? DEFAULT_TRIALS));
	const lambda = options.lambda ?? DEFAULT_LAMBDA;
	const rand = makeRng(options.seed ?? 0x9e3779b9);

	const finishes: Record<TaskId, number[]> = {};
	const criticalCount: Record<TaskId, number> = {};
	for (const id of graph.taskIds) {
		finishes[id] = new Array(trials);
		criticalCount[id] = 0;
	}
	const projectFinishes = new Array<number>(trials);
	const EPS = 1e-9;
	// When the doc is on a team calendar, each trial scales its sampled
	// durations the same way the deterministic engine does — baseline pass to
	// find overlap, then divide by capacity per peer. Falls back to a single
	// pass when capacity is 0 or team mode is off.
	const teamCapacity = teamCapacityPerDay(doc);

	for (let trial = 0; trial < trials; trial += 1) {
		const sampled: Record<TaskId, number> = {};
		for (const id of graph.order) {
			sampled[id] = sampleTaskDuration(graph.tasks[id], rand, lambda);
		}

		const dur: Record<TaskId, number> =
			teamCapacity > 0
				? scaleTrialForTeam(graph, sampled, teamCapacity)
				: sampled;

		const es: Record<TaskId, number> = {};
		const ef: Record<TaskId, number> = {};
		// Forward pass with (possibly team-scaled) durations.
		for (const id of graph.order) {
			let start = 0;
			for (const edge of graph.predecessors[id]) {
				const c = startFrom(edge, es, ef, dur[id]);
				if (c > start) start = c;
			}
			es[id] = start;
			ef[id] = start + dur[id];
		}
		let projectFinish = 0;
		for (const id of graph.order) {
			if (ef[id] > projectFinish) projectFinish = ef[id];
		}
		projectFinishes[trial] = projectFinish;

		// Backward pass to mark which tasks were critical THIS trial.
		const lf: Record<TaskId, number> = {};
		const ls: Record<TaskId, number> = {};
		for (let i = graph.order.length - 1; i >= 0; i -= 1) {
			const id = graph.order[i];
			let latestFinish = projectFinish;
			if (graph.successors[id].length > 0) {
				latestFinish = Number.POSITIVE_INFINITY;
				for (const edge of graph.successors[id]) {
					const succLs = ls[edge.to];
					const succLf = lf[edge.to];
					const candidate = (() => {
						switch (edge.type) {
							case "finish_to_start":
								return succLs - edge.lag;
							case "start_to_start":
								return succLs - edge.lag + dur[id];
							case "finish_to_finish":
								return succLf - edge.lag;
							case "start_to_finish":
								return succLf - edge.lag + dur[id];
						}
					})();
					if (candidate < latestFinish) latestFinish = candidate;
				}
			}
			lf[id] = latestFinish;
			ls[id] = latestFinish - dur[id];
		}
		for (const id of graph.order) {
			finishes[id][trial] = ef[id];
			if (Math.abs(ls[id] - es[id]) <= EPS) criticalCount[id] += 1;
		}
	}

	const tasksOut: Record<TaskId, MonteCarloTask> = {};
	const cal = doc.calendar;
	for (const id of graph.taskIds) {
		const sorted = [...finishes[id]].sort((a, b) => a - b);
		const mean = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
		const p50 = percentile(sorted, 0.5);
		const p90 = percentile(sorted, 0.9);
		tasksOut[id] = {
			taskId: id,
			p10: percentile(sorted, 0.1),
			p50,
			p90,
			mean,
			criticality: criticalCount[id] / trials,
			p50Date: dayOffsetToDate(p50, cal),
			p90Date: dayOffsetToDate(p90, cal),
		};
	}
	const sortedProject = [...projectFinishes].sort((a, b) => a - b);
	const projectMean =
		sortedProject.reduce((s, v) => s + v, 0) / sortedProject.length;
	const projectP50 = percentile(sortedProject, 0.5);
	const projectP90 = percentile(sortedProject, 0.9);

	return {
		trials,
		projectFinish: {
			p10: percentile(sortedProject, 0.1),
			p50: projectP50,
			p90: projectP90,
			mean: projectMean,
			p50Date: dayOffsetToDate(projectP50, cal),
			p90Date: dayOffsetToDate(projectP90, cal),
		},
		tasks: tasksOut,
	};
}

// Per-trial team-capacity scaling. Same idea as schedule.ts: a baseline
// forward-pass on the trial's sampled durations gives each task an ES/EF
// window; the peer count in that window times the original sampled duration,
// divided by capacity, becomes the trial's effective duration.
function scaleTrialForTeam(
	graph: SimGraph,
	sampled: Record<TaskId, number>,
	capacityPerDay: number,
): Record<TaskId, number> {
	const es: Record<TaskId, number> = {};
	const ef: Record<TaskId, number> = {};
	for (const id of graph.order) {
		let start = 0;
		for (const edge of graph.predecessors[id]) {
			const c = startFrom(edge, es, ef, sampled[id]);
			if (c > start) start = c;
		}
		es[id] = start;
		ef[id] = start + sampled[id];
	}
	const scaled: Record<TaskId, number> = {};
	for (const id of graph.taskIds) {
		const dur = sampled[id];
		if (dur <= 0) {
			scaled[id] = 0;
			continue;
		}
		let peers = 1;
		for (const other of graph.taskIds) {
			if (other === id) continue;
			if (sampled[other] <= 0) continue;
			if (es[other] < ef[id] && ef[other] > es[id]) peers += 1;
		}
		scaled[id] = (dur * peers) / capacityPerDay;
	}
	return scaled;
}

// Helpful for sanity-checking that mean ≈ deterministic expected for symmetric
// estimates. Used in tests and the inspector "compare to plan" pill.
export function expectedDaysOf(task: Task): number {
	return expectedDays(task.estimate);
}

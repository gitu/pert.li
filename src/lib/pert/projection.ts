import { getDescendants, getNearestCollapsedAncestor } from "./hierarchy";
import { type Schedule, type ScheduleResult, statusOf } from "./schedule";
import type {
	Dependency,
	DependencyType,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// View-layer projection over the PertDoc + per-user collapse state. Produces
// the set of nodes and edges the canvas should render, with edges that cross
// a collapsed container's boundary rerouted to the container (or to a
// matching interface, once Phase 5b wires the interface UI).
//
// The projection is read-only — it never writes to the doc. The doc keeps
// the full graph; collapse just hides parts of it visually.

export type ContainerRollup = {
	containerId: TaskId;
	descendantCount: number;
	scheduledCount: number;
	expected: number;
	minSlack: number | null;
	criticalCount: number;
	hasCritical: boolean;
	// Status rollup: how many descendants are completed / in progress / not
	// started, and the average %-complete across leaves (weighted by expected
	// duration so half-finishing a long task counts more than half-finishing
	// a tiny one). UI uses this for the container's completion bar.
	completedCount: number;
	inProgressCount: number;
	notStartedCount: number;
	progress: number; // 0..100
};

export type ProjectedNode =
	| {
			kind: "leaf";
			task: Task;
	  }
	| {
			kind: "container-expanded";
			task: Task;
	  }
	| {
			kind: "container-collapsed";
			task: Task;
			rollup: ContainerRollup;
	  };

export type ProjectedEdge = {
	id: string;
	source: TaskId;
	target: TaskId;
	dependencyType: DependencyType;
	rerouted: boolean;
	hidden: boolean;
	critical: boolean;
	originalDependency: Dependency;
};

export type ProjectedGraph = {
	nodes: ProjectedNode[];
	edges: ProjectedEdge[];
};

export function projectGraph(
	doc: PertDoc,
	scheduleResult: ScheduleResult,
	collapsed: ReadonlySet<TaskId>,
): ProjectedGraph {
	const schedule: Schedule | null = scheduleResult.ok
		? scheduleResult.schedule
		: null;

	const nodes: ProjectedNode[] = [];
	for (const task of Object.values(doc.tasksById)) {
		// Drop anything that lives inside a collapsed ancestor.
		const collapsedAncestor = getNearestCollapsedAncestor(
			doc,
			task.id,
			collapsed,
		);
		if (collapsedAncestor && collapsedAncestor !== task.id) continue;

		if (task.kind === "container") {
			if (collapsed.has(task.id)) {
				nodes.push({
					kind: "container-collapsed",
					task,
					rollup: rollupContainer(doc, schedule, task.id),
				});
			} else {
				nodes.push({ kind: "container-expanded", task });
			}
		} else {
			nodes.push({ kind: "leaf", task });
		}
	}

	const edges: ProjectedEdge[] = [];
	const criticalSet: Set<TaskId> = new Set(
		schedule ? schedule.criticalTaskIds : [],
	);
	for (const dep of Object.values(doc.dependenciesById)) {
		const fromId = dep.from.taskId;
		const toId = dep.to.taskId;
		if (!fromId || !toId) continue;
		if (!doc.tasksById[fromId] || !doc.tasksById[toId]) continue;

		const fromCollapsed = getNearestCollapsedAncestor(doc, fromId, collapsed);
		const toCollapsed = getNearestCollapsedAncestor(doc, toId, collapsed);
		const source = fromCollapsed ?? fromId;
		const target = toCollapsed ?? toId;

		// An edge that both ends inside the same collapsed container is fully
		// internal — hide it from the projection.
		if (source === target) continue;

		const rerouted = source !== fromId || target !== toId;
		const isCritical =
			!rerouted && criticalSet.has(fromId) && criticalSet.has(toId);
		edges.push({
			id: dep.id,
			source,
			target,
			dependencyType: dep.type,
			rerouted,
			hidden: false,
			critical: isCritical,
			originalDependency: dep,
		});
	}

	return { nodes, edges };
}

// Aggregates schedule statistics over every leaf descendant of a container.
// Pure — schedule is whatever the caller already computed; we just sum and
// minimise. When schedule is null (cycle), returns zeroes with minSlack=null.
export function rollupContainer(
	doc: PertDoc,
	schedule: Schedule | null,
	containerId: TaskId,
): ContainerRollup {
	const descendantIds = getDescendants(doc, containerId);
	let expected = 0;
	let minSlack: number | null = null;
	let criticalCount = 0;
	let scheduledCount = 0;
	let leafCount = 0;
	let completedCount = 0;
	let inProgressCount = 0;
	let notStartedCount = 0;
	let weightedProgress = 0;
	let progressWeight = 0;
	for (const id of descendantIds) {
		const t = doc.tasksById[id];
		if (!t || t.kind === "container") continue;
		leafCount += 1;
		const s = schedule?.tasks[id];
		const status = statusOf(t);
		if (status === "completed") completedCount += 1;
		else if (status === "in_progress") inProgressCount += 1;
		else notStartedCount += 1;
		if (!s) continue;
		scheduledCount += 1;
		expected += s.expected;
		if (minSlack === null || s.slack < minSlack) minSlack = s.slack;
		if (s.critical) criticalCount += 1;
		const w = s.expected > 0 ? s.expected : 1;
		weightedProgress += s.progress * w;
		progressWeight += w;
	}
	const progress = progressWeight > 0 ? weightedProgress / progressWeight : 0;
	return {
		containerId,
		descendantCount: leafCount,
		scheduledCount,
		expected,
		minSlack,
		criticalCount,
		hasCritical: criticalCount > 0,
		completedCount,
		inProgressCount,
		notStartedCount,
		progress,
	};
}

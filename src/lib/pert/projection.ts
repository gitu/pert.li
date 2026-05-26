import { getDescendants, getNearestCollapsedAncestor } from "./hierarchy";
import { getPrimaryInterface } from "./interfaces";
import type { MonteCarloResult } from "./montecarlo";
import { type Schedule, type ScheduleResult, statusOf } from "./schedule";
import type {
	Dependency,
	DependencyType,
	InterfaceId,
	InterfaceKind,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// View-layer projection over the PertDoc + per-user collapse state. Produces
// the set of nodes and edges the canvas should render. Edges that cross a
// collapsed container's boundary are rerouted to a specific interface handle
// on the container card. Resolution order for which interface to use:
//   1. The dependency's `interfaceId` hint, if it names an interface on the
//      collapsed container.
//   2. An interface whose `taskRef` matches the original descendant on that
//      side of the edge.
//   3. The container's primary interface of the appropriate kind (exit for
//      outbound, entry for inbound). `ensureContainerInterfaces` guarantees
//      one exists.
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
	// When the source/target was rerouted to a collapsed container, this names
	// the specific interface handle the edge should attach to on that side.
	// Unset when no rerouting occurred (the edge endpoint is a leaf task).
	sourceInterfaceId?: InterfaceId;
	targetInterfaceId?: InterfaceId;
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

		const sourceInterfaceId = fromCollapsed
			? resolveInterface(
					doc,
					fromCollapsed,
					fromId,
					dep.from.interfaceId,
					"exit",
				)
			: undefined;
		const targetInterfaceId = toCollapsed
			? resolveInterface(doc, toCollapsed, toId, dep.to.interfaceId, "entry")
			: undefined;

		const rerouted = source !== fromId || target !== toId;
		const isCritical =
			!rerouted && criticalSet.has(fromId) && criticalSet.has(toId);
		edges.push({
			id: dep.id,
			source,
			target,
			sourceInterfaceId,
			targetInterfaceId,
			dependencyType: dep.type,
			rerouted,
			hidden: false,
			critical: isCritical,
			originalDependency: dep,
		});
	}

	return { nodes, edges };
}

// Pick which interface handle on a collapsed container an edge should attach
// to. See top-of-file resolution order.
function resolveInterface(
	doc: PertDoc,
	containerId: TaskId,
	originalTaskId: TaskId,
	hint: InterfaceId | undefined,
	kind: InterfaceKind,
): InterfaceId | undefined {
	const bucket = doc.interfacesByContainerId[containerId];
	if (!bucket) return undefined;
	if (hint && bucket[hint]) return hint;
	for (const iface of Object.values(bucket)) {
		if (iface.kind === kind && iface.taskRef === originalTaskId)
			return iface.id;
	}
	return getPrimaryInterface(doc, containerId, kind)?.id;
}

// Per-(entry, exit) scheduling stats for a container. Computed only for
// interface pairs where BOTH sides have a bound `taskRef` — the unbound
// defaults fall back to the whole-container `rollupContainer` view.
//
// `expected` is the forward-pass duration from the entry's referenced task
// start to the exit's referenced task finish. `p50` / `p90` are the
// Monte Carlo finish-time percentiles at the exit task, offset by the
// entry task's median start so the numbers read as "time spent inside
// this container from this entry to this exit." When the schedule cannot
// be computed (cycle), returns an empty list.
export type ContainerPathRollup = {
	entryId: InterfaceId;
	entryLabel: string;
	exitId: InterfaceId;
	exitLabel: string;
	expected: number;
	p50?: number;
	p90?: number;
	criticality?: number;
};

export function rollupContainerPaths(
	doc: PertDoc,
	schedule: Schedule | null,
	mc: MonteCarloResult | null,
	containerId: TaskId,
): ContainerPathRollup[] {
	if (!schedule) return [];
	const bucket = doc.interfacesByContainerId[containerId];
	if (!bucket) return [];
	const entries: Array<{ id: InterfaceId; label: string; taskRef: TaskId }> =
		[];
	const exits: Array<{ id: InterfaceId; label: string; taskRef: TaskId }> = [];
	for (const iface of Object.values(bucket)) {
		if (!iface.taskRef) continue;
		const target = iface.kind === "entry" ? entries : exits;
		target.push({ id: iface.id, label: iface.label, taskRef: iface.taskRef });
	}
	if (entries.length === 0 || exits.length === 0) return [];
	const out: ContainerPathRollup[] = [];
	for (const entry of entries) {
		const entrySchedule = schedule.tasks[entry.taskRef];
		const entryMc = mc?.tasks[entry.taskRef];
		if (!entrySchedule) continue;
		for (const exit of exits) {
			const exitSchedule = schedule.tasks[exit.taskRef];
			if (!exitSchedule) continue;
			const exitMc = mc?.tasks[exit.taskRef];
			const expected = Math.max(
				0,
				exitSchedule.earliestFinish - entrySchedule.earliestStart,
			);
			const entryAnchor = entryMc?.p50 ?? entrySchedule.earliestStart;
			const path: ContainerPathRollup = {
				entryId: entry.id,
				entryLabel: entry.label,
				exitId: exit.id,
				exitLabel: exit.label,
				expected,
			};
			if (exitMc) {
				path.p50 = Math.max(0, exitMc.p50 - entryAnchor);
				path.p90 = Math.max(0, exitMc.p90 - entryAnchor);
				path.criticality = exitMc.criticality;
			}
			out.push(path);
		}
	}
	return out;
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

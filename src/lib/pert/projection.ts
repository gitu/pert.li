import {
	filterCollapsedToRendered,
	getNearestCollapsedAncestorGroup,
	getNearestCollapsedGroup,
	getTasksInGroupDeep,
	isGroupRendered,
} from "./hierarchy";
import { type Schedule, type ScheduleResult, statusOf } from "./schedule";
import type {
	Dependency,
	DependencyType,
	Group,
	GroupId,
	PertDoc,
	Task,
	TaskId,
} from "./types";

// View-layer projection over the PertDoc + per-user collapse state. Produces
// the set of nodes and edges the canvas should render. A group renders as a box
// (expanded = translucent panel around its members; collapsed = a single card
// with rolled-up schedule stats). Edges that cross a collapsed group's boundary
// reroute to the group's card.
//
// The projection is read-only — it never writes to the doc. The doc keeps the
// full graph; collapse just hides parts of it visually.

export type GroupRollup = {
	groupId: GroupId;
	descendantCount: number;
	scheduledCount: number;
	expected: number;
	minSlack: number | null;
	criticalCount: number;
	hasCritical: boolean;
	// Status rollup: how many member tasks are completed / in progress / not
	// started, and the average %-complete across them (weighted by expected
	// duration so half-finishing a long task counts more than half-finishing a
	// tiny one). UI uses this for the group's completion bar.
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
			kind: "group-expanded";
			group: Group;
	  }
	| {
			kind: "group-collapsed";
			group: Group;
			rollup: GroupRollup;
	  };

export type ProjectedEdge = {
	id: string;
	// Source/target is a TaskId, or a GroupId when the endpoint was rerouted to
	// a collapsed group's card.
	source: string;
	target: string;
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
	collapsed: ReadonlySet<GroupId>,
	maxLevel: number = Number.POSITIVE_INFINITY,
): ProjectedGraph {
	const schedule: Schedule | null = scheduleResult.ok
		? scheduleResult.schedule
		: null;

	// Collapse only applies to groups that render under the cap; a folded-away
	// group must not hide its members or reroute its edges (it has no node).
	const collapsedRendered = filterCollapsedToRendered(doc, collapsed, maxLevel);

	const nodes: ProjectedNode[] = [];

	// Group boxes. A group hidden inside a collapsed ancestor group is not
	// emitted (it's folded into the ancestor's card), and a group beyond the
	// depth cap renders no box (its tasks fold into the nearest shown ancestor).
	for (const group of Object.values(doc.groupsById)) {
		if (!isGroupRendered(doc, group.id, maxLevel)) continue;
		const collapsedAncestor = getNearestCollapsedAncestorGroup(
			doc,
			group.id,
			collapsedRendered,
		);
		if (collapsedAncestor && collapsedAncestor !== group.id) continue;
		if (collapsedRendered.has(group.id)) {
			nodes.push({
				kind: "group-collapsed",
				group,
				rollup: rollupGroup(doc, schedule, group.id),
			});
		} else {
			nodes.push({ kind: "group-expanded", group });
		}
	}

	// Leaf tasks. A task inside a collapsed group is folded into that group's
	// card and not emitted.
	for (const task of Object.values(doc.tasksById)) {
		if (getNearestCollapsedGroup(doc, task.id, collapsedRendered)) continue;
		nodes.push({ kind: "leaf", task });
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

		const fromCollapsed = getNearestCollapsedGroup(
			doc,
			fromId,
			collapsedRendered,
		);
		const toCollapsed = getNearestCollapsedGroup(doc, toId, collapsedRendered);
		const source = fromCollapsed ?? fromId;
		const target = toCollapsed ?? toId;

		// An edge that both ends inside the same collapsed group is fully
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

// Aggregates schedule statistics over every task in a group (and its descendant
// groups). Pure — schedule is whatever the caller already computed; we just sum
// and minimise. When schedule is null (cycle), returns zeroes with minSlack=null.
export function rollupGroup(
	doc: PertDoc,
	schedule: Schedule | null,
	groupId: GroupId,
): GroupRollup {
	const members = getTasksInGroupDeep(doc, groupId);
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
	for (const t of members) {
		leafCount += 1;
		const s = schedule?.tasks[t.id];
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
		groupId,
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

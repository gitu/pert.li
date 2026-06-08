import type { Group, GroupId, PertDoc, Task, TaskId } from "./types";

// Pure helpers over the group tree. The Automerge doc stores `parentGroupId`
// on each group and `groupId` on each task; everything else is derived here so
// the shape stays merge-friendly (per vision §"Synchronization and conflict
// handling" — avoid materialising parallel structures). All walkers are
// cycle-safe: a malformed doc must never deadlock the engine.

function bySiblingOrder(a: Group, b: Group): number {
	const ao = a.order ?? 0;
	const bo = b.order ?? 0;
	if (ao !== bo) return ao - bo;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function getChildGroups(
	doc: PertDoc,
	parentGroupId: GroupId | null,
): Group[] {
	const out: Group[] = [];
	for (const g of Object.values(doc.groupsById)) {
		if ((g.parentGroupId ?? null) === parentGroupId) out.push(g);
	}
	return out.sort(bySiblingOrder);
}

export function getRootGroups(doc: PertDoc): Group[] {
	return getChildGroups(doc, null);
}

// Walks parentGroupId up to the root. Detects cycles defensively and stops at
// the first repeat.
export function getGroupAncestors(doc: PertDoc, groupId: GroupId): GroupId[] {
	const seen = new Set<GroupId>([groupId]);
	const out: GroupId[] = [];
	let cursor = doc.groupsById[groupId]?.parentGroupId ?? null;
	while (cursor) {
		if (seen.has(cursor)) break;
		seen.add(cursor);
		out.push(cursor);
		cursor = doc.groupsById[cursor]?.parentGroupId ?? null;
	}
	return out;
}

// Iterative BFS so deep trees don't blow the call stack. Returns descendant
// GROUP ids (not the root itself).
export function getGroupDescendants(doc: PertDoc, rootId: GroupId): GroupId[] {
	const out: GroupId[] = [];
	const queue: GroupId[] = [rootId];
	const seen = new Set<GroupId>([rootId]);
	while (queue.length > 0) {
		const next = queue.shift() as GroupId;
		for (const g of Object.values(doc.groupsById)) {
			if ((g.parentGroupId ?? null) !== next) continue;
			if (seen.has(g.id)) continue;
			seen.add(g.id);
			out.push(g.id);
			queue.push(g.id);
		}
	}
	return out;
}

function byTaskOrder(a: Task, b: Task): number {
	const ao = a.order ?? 0;
	const bo = b.order ?? 0;
	if (ao !== bo) return ao - bo;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Direct member tasks of a group (sorted by `(order, id)`).
export function getTasksInGroup(doc: PertDoc, groupId: GroupId): Task[] {
	const out: Task[] = [];
	for (const t of Object.values(doc.tasksById)) {
		if ((t.groupId ?? null) === groupId) out.push(t);
	}
	return out.sort(byTaskOrder);
}

// Member tasks of a group and every descendant group.
export function getTasksInGroupDeep(doc: PertDoc, groupId: GroupId): Task[] {
	const groupIds = new Set<GroupId>([
		groupId,
		...getGroupDescendants(doc, groupId),
	]);
	const out: Task[] = [];
	for (const t of Object.values(doc.tasksById)) {
		const gid = t.groupId ?? null;
		if (gid && groupIds.has(gid)) out.push(t);
	}
	return out;
}

// The nearest group at or above `groupId` that is collapsed, or null. Used by
// the projection layer to decide where an edge reroutes and which group boxes
// are hidden inside a collapsed ancestor.
export function getNearestCollapsedAncestorGroup(
	doc: PertDoc,
	groupId: GroupId,
	collapsed: ReadonlySet<GroupId>,
): GroupId | null {
	if (collapsed.has(groupId)) return groupId;
	for (const ancestor of getGroupAncestors(doc, groupId)) {
		if (collapsed.has(ancestor)) return ancestor;
	}
	return null;
}

// The nearest collapsed group a task lives inside (its own group, then that
// group's ancestors), or null when the task is visible.
export function getNearestCollapsedGroup(
	doc: PertDoc,
	taskId: TaskId,
	collapsed: ReadonlySet<GroupId>,
): GroupId | null {
	const gid = doc.tasksById[taskId]?.groupId ?? null;
	if (!gid || !doc.groupsById[gid]) return null;
	return getNearestCollapsedAncestorGroup(doc, gid, collapsed);
}

// True if `candidate` is `rootId` or any descendant group. The cycle guard for
// re-parenting a group: a group can't be moved under itself or its descendants.
export function isGroupWithin(
	doc: PertDoc,
	candidate: GroupId,
	rootId: GroupId,
): boolean {
	if (candidate === rootId) return true;
	return getGroupAncestors(doc, candidate).includes(rootId);
}

// --- Grouping level (canvas depth cap) ------------------------------------
//
// The canvas can cap how deep group boxes render: only groups whose WBS level
// is within the cap draw a box; deeper groups fold their tasks into the nearest
// shown ancestor. A group's WBS level matches its depth in the tree — a root
// group is level 1, its children level 2, and so on. Because level is monotonic
// with depth, "render up to level N" is just truncating the tree at depth N.
//
// The cap is a number: `Number.POSITIVE_INFINITY` = all levels, `0` = grouping
// off (no boxes at all).

// WBS level of a group (1-based: root groups are level 1).
export function groupLevel(doc: PertDoc, groupId: GroupId): number {
	return getGroupAncestors(doc, groupId).length + 1;
}

// Whether a group renders as a box under the given depth cap.
export function isGroupRendered(
	doc: PertDoc,
	groupId: GroupId,
	maxLevel: number,
): boolean {
	if (maxLevel <= 0) return false;
	return groupLevel(doc, groupId) <= maxLevel;
}

// Restrict a collapse set to the groups that actually render under the cap.
// A collapsed group that the depth cap has folded away (or any collapse when
// grouping is off) must NOT take effect — otherwise its members would be
// hidden / its edges rerouted to a group node that is never drawn. Collapse
// state for folded groups is preserved in the store, just ignored while the
// cap hides them, so raising the cap restores it.
export function filterCollapsedToRendered(
	doc: PertDoc,
	collapsed: ReadonlySet<GroupId>,
	maxLevel: number,
): ReadonlySet<GroupId> {
	// Fast path: an uncapped view renders every group, so nothing is filtered.
	if (collapsed.size === 0 || maxLevel === Number.POSITIVE_INFINITY) {
		return collapsed;
	}
	const out = new Set<GroupId>();
	for (const id of collapsed) {
		if (isGroupRendered(doc, id, maxLevel)) out.add(id);
	}
	return out;
}

// The rendered group a task folds into under the cap: its own group when that
// group renders, otherwise the nearest ancestor still within the cap, or null
// when the task is ungrouped or grouping is off.
export function effectiveGroupForTask(
	doc: PertDoc,
	taskId: TaskId,
	maxLevel: number,
): GroupId | null {
	const gid = doc.tasksById[taskId]?.groupId ?? null;
	if (!gid || !doc.groupsById[gid] || maxLevel <= 0) return null;
	if (groupLevel(doc, gid) <= maxLevel) return gid;
	for (const anc of getGroupAncestors(doc, gid)) {
		if (groupLevel(doc, anc) <= maxLevel) return anc;
	}
	return null;
}

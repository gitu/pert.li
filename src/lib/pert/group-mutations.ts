import { getChildGroups, getTasksInGroup, isGroupWithin } from "./hierarchy";
import type { GroupId, Layout, PertDoc, TaskId } from "./types";

// In-place mutators for the first-class Group model. Each takes a draft
// `PertDoc` (the object Automerge `change()` hands you) plus typed args and
// edits it in place, returning a small JSON-friendly result. Shared by the AI
// tool-mutators, the canvas, and the inspector so the numbering/promote rules
// live in exactly one place.
//
// Numbering note: a group never stores its WBS number (it's derived in
// numbering.ts). Moving a task only changes `groupId`/`order`, so its auto
// number recomputes while any `numberOverride` is left untouched — that is the
// whole of the "auto-renumber on move unless pinned" rule.

export function newGroupId(): GroupId {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `grp_${s}`;
}

function nextGroupOrder(doc: PertDoc, parentGroupId: GroupId | null): number {
	let max = -1;
	for (const g of getChildGroups(doc, parentGroupId)) {
		if ((g.order ?? 0) > max) max = g.order ?? 0;
	}
	return max + 1;
}

function nextTaskOrder(doc: PertDoc, groupId: GroupId): number {
	let max = -1;
	for (const t of getTasksInGroup(doc, groupId)) {
		if ((t.order ?? 0) > max) max = t.order ?? 0;
	}
	return max + 1;
}

export type CreateGroupArgs = {
	name?: string;
	parentGroupId?: GroupId | null;
	layout?: Layout;
	// Explicit id so a propose_changes batch can forward-reference the group
	// before it is created.
	id?: GroupId;
};

export function createGroupMutation(
	doc: PertDoc,
	args: CreateGroupArgs,
): { ok: true; id: GroupId } | { ok: false; error: string } {
	const parentGroupId = args.parentGroupId ?? null;
	if (parentGroupId && !doc.groupsById[parentGroupId]) {
		return { ok: false, error: `parent group ${parentGroupId} not found` };
	}
	const id = args.id ?? newGroupId();
	if (doc.groupsById[id])
		return { ok: false, error: `group ${id} already exists` };
	doc.groupsById[id] = {
		id,
		name: args.name?.trim() || "New group",
		parentGroupId,
		order: nextGroupOrder(doc, parentGroupId),
		...(args.layout ? { layout: args.layout } : {}),
	};
	return { ok: true, id };
}

export function renameGroupMutation(
	doc: PertDoc,
	args: { groupId: GroupId; name: string },
): { ok: true } | { ok: false; error: string } {
	const group = doc.groupsById[args.groupId];
	if (!group) return { ok: false, error: `group ${args.groupId} not found` };
	group.name = args.name.trim();
	return { ok: true };
}

export function setGroupParentMutation(
	doc: PertDoc,
	args: { groupId: GroupId; parentGroupId: GroupId | null },
): { ok: true } | { ok: false; error: string } {
	const group = doc.groupsById[args.groupId];
	if (!group) return { ok: false, error: `group ${args.groupId} not found` };
	const parentGroupId = args.parentGroupId ?? null;
	if (parentGroupId) {
		if (!doc.groupsById[parentGroupId]) {
			return { ok: false, error: `parent group ${parentGroupId} not found` };
		}
		// A group can't be nested under itself or one of its descendants.
		if (isGroupWithin(doc, parentGroupId, args.groupId)) {
			return { ok: false, error: "would create a group cycle" };
		}
	}
	if ((group.parentGroupId ?? null) === parentGroupId) return { ok: true };
	group.parentGroupId = parentGroupId;
	group.order = nextGroupOrder(doc, parentGroupId);
	return { ok: true };
}

// Deleting a group promotes its contents: member tasks move up to the group's
// parent (or ungrouped), child groups re-parent to the grandparent. Tasks are
// never cascade-deleted.
export function deleteGroupMutation(
	doc: PertDoc,
	args: { groupId: GroupId },
):
	| { ok: true; promotedTasks: number; promotedGroups: number }
	| {
			ok: false;
			error: string;
	  } {
	const group = doc.groupsById[args.groupId];
	if (!group) return { ok: false, error: `group ${args.groupId} not found` };
	const newParent = group.parentGroupId ?? null;
	let promotedTasks = 0;
	// Compute the append cursor ONCE and increment locally — recomputing inside
	// the loop would rescan the destination's members on every promotion (O(n²)).
	let taskOrder = newParent === null ? 0 : nextTaskOrder(doc, newParent);
	for (const t of getTasksInGroup(doc, args.groupId)) {
		t.groupId = newParent;
		// Append into the new parent (or drop ordering entirely when ungrouped).
		if (newParent === null) delete t.order;
		else t.order = taskOrder++;
		promotedTasks += 1;
	}
	let promotedGroups = 0;
	let groupOrder = nextGroupOrder(doc, newParent);
	for (const child of getChildGroups(doc, args.groupId)) {
		child.parentGroupId = newParent;
		child.order = groupOrder++;
		promotedGroups += 1;
	}
	delete doc.groupsById[args.groupId];
	return { ok: true, promotedTasks, promotedGroups };
}

export function assignTaskToGroupMutation(
	doc: PertDoc,
	args: { taskId: TaskId; groupId: GroupId | null },
): { ok: true } | { ok: false; error: string } {
	const task = doc.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const groupId = args.groupId ?? null;
	if (groupId && !doc.groupsById[groupId]) {
		return { ok: false, error: `group ${groupId} not found` };
	}
	if ((task.groupId ?? null) === groupId) return { ok: true };
	if (groupId === null) {
		task.groupId = null;
		delete task.order;
	} else {
		task.groupId = groupId;
		task.order = nextTaskOrder(doc, groupId);
	}
	return { ok: true };
}

// Sets or clears a task's manual WBS-number override. Passing null or an empty
// string clears the override and reverts the task to its derived number.
export function setTaskNumberMutation(
	doc: PertDoc,
	args: { taskId: TaskId; number: string | null },
): { ok: true } | { ok: false; error: string } {
	const task = doc.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const trimmed = args.number?.trim();
	if (!trimmed) delete task.numberOverride;
	else task.numberOverride = trimmed;
	return { ok: true };
}

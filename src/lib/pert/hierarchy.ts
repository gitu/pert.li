import type { PertDoc, Task, TaskId } from "./types";

// Pure helpers over the nested container tree. The Automerge doc stores
// only `parentId` on each task; everything else is derived here so the
// shape stays merge-friendly (per vision §"Synchronization and conflict
// handling" — avoid materialising parallel structures).

export function getChildren(doc: PertDoc, parentId: TaskId | null): Task[] {
	const children: Task[] = [];
	for (const t of Object.values(doc.tasksById)) {
		if ((t.parentId ?? null) === parentId) children.push(t);
	}
	return children;
}

export function getRootTasks(doc: PertDoc): Task[] {
	return getChildren(doc, null);
}

// Walks parentId up to the root. Detects cycles defensively and stops at
// the first repeat — a malformed doc should never deadlock the engine.
export function getAncestors(doc: PertDoc, taskId: TaskId): TaskId[] {
	const seen = new Set<TaskId>([taskId]);
	const out: TaskId[] = [];
	let cursor = doc.tasksById[taskId]?.parentId ?? null;
	while (cursor) {
		if (seen.has(cursor)) break;
		seen.add(cursor);
		out.push(cursor);
		cursor = doc.tasksById[cursor]?.parentId ?? null;
	}
	return out;
}

// Iterative BFS so deep trees don't blow the call stack.
export function getDescendants(doc: PertDoc, rootId: TaskId): TaskId[] {
	const out: TaskId[] = [];
	const queue: TaskId[] = [rootId];
	const seen = new Set<TaskId>([rootId]);
	while (queue.length > 0) {
		const next = queue.shift() as TaskId;
		for (const t of Object.values(doc.tasksById)) {
			if ((t.parentId ?? null) !== next) continue;
			if (seen.has(t.id)) continue;
			seen.add(t.id);
			out.push(t.id);
			queue.push(t.id);
		}
	}
	return out;
}

// The nearest ancestor (including the task itself) that is collapsed, or
// null if no ancestor is collapsed. Used by the projection layer to
// determine where an edge should reroute to.
export function getNearestCollapsedAncestor(
	doc: PertDoc,
	taskId: TaskId,
	collapsed: ReadonlySet<TaskId>,
): TaskId | null {
	if (collapsed.has(taskId)) return taskId;
	for (const ancestor of getAncestors(doc, taskId)) {
		if (collapsed.has(ancestor)) return ancestor;
	}
	return null;
}

// True if `candidate` is `rootId` or any descendant. Cheaper than building
// the full descendant set when the caller only needs a containment check.
export function isWithin(
	doc: PertDoc,
	candidate: TaskId,
	rootId: TaskId,
): boolean {
	if (candidate === rootId) return true;
	return getAncestors(doc, candidate).includes(rootId);
}

export function getContainers(doc: PertDoc): Task[] {
	const out: Task[] = [];
	for (const t of Object.values(doc.tasksById)) {
		if (t.kind === "container") out.push(t);
	}
	return out;
}

import type { GroupId, PertDoc, TaskId } from "./types";

// Derived WBS numbering. A group seeds the number of its members:
//   root groups → "1", "2", … (by sibling order)
//   a child group of "1" → "1.1", "1.2", …
//   a task in group "1.2" → "1.2.1", "1.2.2", …
//
// Numbers are DERIVED, never stored on the doc (per the doc shape rule: content
// only, no derived analytics written back). The single stored hook is
// `task.numberOverride` — when present it wins over the derived value and
// "sticks" across group moves. This is what makes "auto-renumber on move unless
// pinned" fall out for free: a move only changes `task.groupId`, so the derived
// number recomputes next render while any override is left untouched.
//
// Ordering is by `(order, id)` because Automerge keyed maps don't preserve
// insertion order across merges — sorting keeps numbering deterministic and
// merge-stable.

export type NumberingResult = {
	// WBS number for every group ("1", "1.2", …).
	groups: Record<GroupId, string>;
	// Final display number for every task: `numberOverride ?? derived`.
	// Ungrouped tasks with no override map to "".
	tasks: Record<TaskId, string>;
};

function bySiblingOrder<T extends { order?: number; id: string }>(
	a: T,
	b: T,
): number {
	const ao = a.order ?? 0;
	const bo = b.order ?? 0;
	if (ao !== bo) return ao - bo;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function computeNumbering(doc: PertDoc): NumberingResult {
	const groups = Object.values(doc.groupsById);

	// Index child groups by their immediate (existing) parent. A group whose
	// parent is missing maps to null = root.
	const childrenByParent = new Map<GroupId | null, typeof groups>();
	const groupById = doc.groupsById;
	for (const g of groups) {
		const p = g.parentGroupId ?? null;
		const parent = p && groupById[p] ? p : null;
		const bucket = childrenByParent.get(parent);
		if (bucket) bucket.push(g);
		else childrenByParent.set(parent, [g]);
	}

	const groupNumbers: Record<GroupId, string> = {};
	let rootIndex = 0;
	function assign(parent: GroupId | null, prefix: string): void {
		const children = (childrenByParent.get(parent) ?? [])
			.slice()
			.sort(bySiblingOrder);
		let local = 0;
		for (const g of children) {
			if (groupNumbers[g.id] !== undefined) continue; // cycle guard
			local += 1;
			let idx: number;
			if (parent === null) {
				rootIndex += 1;
				idx = rootIndex;
			} else {
				idx = local;
			}
			const number = prefix ? `${prefix}.${idx}` : `${idx}`;
			groupNumbers[g.id] = number;
			assign(g.id, number);
		}
	}
	assign(null, "");
	// Promote any group unreachable from a real root (every group in a
	// parentGroupId cycle) to a root so it still gets a number and we always
	// terminate.
	for (const g of groups.slice().sort(bySiblingOrder)) {
		if (groupNumbers[g.id] !== undefined) continue;
		rootIndex += 1;
		const number = `${rootIndex}`;
		groupNumbers[g.id] = number;
		assign(g.id, number);
	}

	// Bucket member tasks by group, then number them within their group.
	const tasksByGroup = new Map<
		GroupId,
		Array<{ id: string; order?: number }>
	>();
	for (const task of Object.values(doc.tasksById)) {
		const gid = task.groupId ?? null;
		if (gid == null || !groupById[gid]) continue;
		const bucket = tasksByGroup.get(gid);
		const entry = { id: task.id, order: task.order };
		if (bucket) bucket.push(entry);
		else tasksByGroup.set(gid, [entry]);
	}

	const derived: Record<TaskId, string> = {};
	for (const [gid, members] of tasksByGroup) {
		const groupNumber = groupNumbers[gid] ?? "";
		members.sort(bySiblingOrder);
		members.forEach((m, idx) => {
			derived[m.id] = groupNumber ? `${groupNumber}.${idx + 1}` : `${idx + 1}`;
		});
	}

	const tasks: Record<TaskId, string> = {};
	for (const task of Object.values(doc.tasksById)) {
		tasks[task.id] = task.numberOverride ?? derived[task.id] ?? "";
	}

	return { groups: groupNumbers, tasks };
}

export function numberOfTask(result: NumberingResult, taskId: TaskId): string {
	return result.tasks[taskId] ?? "";
}

export function numberOfGroup(
	result: NumberingResult,
	groupId: GroupId,
): string {
	return result.groups[groupId] ?? "";
}

import { getGroupAncestors, getTasksInGroupDeep } from "./hierarchy";
import type { GroupId, PertDoc, TaskId } from "./types";

// Pure helpers for "drag a task into a group" and "drag a group card".
//
// `groupBoundsFromMembers` computes a group's axis-aligned bounding box from
// the *current* positions of its member tasks — matching the canvas's render-
// time logic — so drop-target detection uses the same coordinates the user
// sees, even when the doc hasn't been re-laid out.

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

const TASK_WIDTH = 200;
const TASK_HEIGHT = 80;
const GROUP_PAD_X = 36;
const GROUP_PAD_TOP = 44;
const GROUP_PAD_BOTTOM = 36;
const GROUP_MIN_WIDTH = 440;
const GROUP_MIN_HEIGHT = 280;

export function groupBoundsFromMembers(
	doc: PertDoc,
	groupId: GroupId,
	excludeIds?: ReadonlySet<TaskId>,
): Bounds | null {
	const group = doc.groupsById[groupId];
	if (!group) return null;
	const members = getTasksInGroupDeep(doc, groupId);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let any = false;
	for (const t of members) {
		if (excludeIds?.has(t.id)) continue;
		const pos = t.layout?.position;
		if (!pos) continue;
		any = true;
		minX = Math.min(minX, pos.x);
		minY = Math.min(minY, pos.y);
		maxX = Math.max(maxX, pos.x + TASK_WIDTH);
		maxY = Math.max(maxY, pos.y + TASK_HEIGHT);
	}
	if (!any) {
		const ownPos = group.layout?.position ?? { x: 0, y: 0 };
		return {
			x: ownPos.x,
			y: ownPos.y,
			width: group.layout?.width ?? GROUP_MIN_WIDTH,
			height: group.layout?.height ?? GROUP_MIN_HEIGHT,
		};
	}
	return {
		x: minX - GROUP_PAD_X,
		y: minY - GROUP_PAD_TOP,
		width: Math.max(maxX - minX + GROUP_PAD_X * 2, GROUP_MIN_WIDTH),
		height: Math.max(
			maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
			GROUP_MIN_HEIGHT,
		),
	};
}

function pointInBounds(p: Point, b: Bounds): boolean {
	return (
		p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
	);
}

export type GroupSnapshot = {
	id: GroupId;
	bounds: Bounds;
	depth: number;
};

// Snapshot every drop-eligible group's bounds + ancestor depth in one doc walk.
// Drag-time callers use this to avoid recomputing bounds-from-members 60 times
// per second: during a drag the dragged leaf is excluded from each group's
// bounds, the other members don't move, so the snapshot stays accurate for the
// lifetime of the drag. Sorted deepest-first so the per-frame hit test returns
// on first match. Collapsed groups render as a single card and don't accept
// drop-into, so they're skipped.
export function buildGroupSnapshot(
	doc: PertDoc,
	collapsed: ReadonlySet<GroupId>,
	excludeIds?: ReadonlySet<TaskId>,
): GroupSnapshot[] {
	const snap: GroupSnapshot[] = [];
	for (const g of Object.values(doc.groupsById)) {
		if (collapsed.has(g.id)) continue;
		const bounds = groupBoundsFromMembers(doc, g.id, excludeIds);
		if (!bounds) continue;
		snap.push({
			id: g.id,
			bounds,
			depth: getGroupAncestors(doc, g.id).length,
		});
	}
	snap.sort((a, b) => b.depth - a.depth);
	return snap;
}

export function findGroupAtPointInSnapshot(
	snapshot: ReadonlyArray<GroupSnapshot>,
	point: Point,
): GroupId | null {
	for (const s of snapshot) {
		if (pointInBounds(point, s.bounds)) return s.id;
	}
	return null;
}

// Shift every member task's layout.position by (dx, dy). Used when the user
// drags a group card — we re-anchor the members so the group's
// bounds-from-members computation places it at the dropped location.
export function shiftGroupMembersMutation(
	groupId: GroupId,
	dx: number,
	dy: number,
): (doc: PertDoc) => void {
	return (doc) => {
		for (const t of getTasksInGroupDeep(doc, groupId)) {
			const pos = t.layout?.position;
			if (!pos) continue;
			t.layout = {
				...(t.layout ?? {}),
				position: { x: pos.x + dx, y: pos.y + dy },
			};
		}
	};
}

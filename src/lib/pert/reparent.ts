import {
	getChildGroups,
	getGroupAncestors,
	getTasksInGroup,
	getTasksInGroupDeep,
	isGroupRendered,
} from "./hierarchy";
import type { GroupId, PertDoc, TaskId } from "./types";

// Pure helpers for "drag a task into a group" and "drag a group card".
//
// `groupBoundsFromMembers` computes a group's axis-aligned bounding box from
// what is actually *drawn* inside it — matching the canvas's render-time logic —
// so drop-target detection uses the same coordinates the user sees, even when
// the doc hasn't been re-laid out. The box mirrors the canvas exactly:
//   - direct member tasks contribute their card rect;
//   - a collapsed child group contributes only its collapsed card rect (min
//     220×96, larger if the user saved a resize) — NOT the stale, hidden
//     positions of its members, which is what used to balloon a parent box
//     when an inner group was collapsed;
//   - a child group folded away by the depth cap contributes its members'
//     positions (they render loose inside this box);
//   - an expanded, rendered child group contributes its own recursive box.

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

const TASK_WIDTH = 200;
const TASK_HEIGHT = 80;
const GROUP_PAD_X = 36;
const GROUP_PAD_TOP = 44;
const GROUP_PAD_BOTTOM = 36;
const GROUP_MIN_WIDTH = 440;
const GROUP_MIN_HEIGHT = 280;
// Collapsed-card footprint. Keep in sync with `COLLAPSED_CARD_WIDTH` /
// `groupCollapsedHeight` in src/components/pert/canvas/group-node.tsx.
const COLLAPSED_CARD_WIDTH = 220;
const COLLAPSED_CARD_HEIGHT = 96;

const EMPTY_GROUP_SET: ReadonlySet<GroupId> = new Set();

export type GroupBoundsOptions = {
	/** Per-user collapsed group ids. Collapsed children shrink to a card. */
	collapsed?: ReadonlySet<GroupId>;
	/** Depth cap — groups beyond it fold into the nearest shown ancestor. */
	maxLevel?: number;
	/** Tasks to ignore (e.g. the leaf being dragged). */
	excludeIds?: ReadonlySet<TaskId>;
};

type BoundsAcc = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	any: boolean;
};

function unionRect(
	acc: BoundsAcc,
	x: number,
	y: number,
	w: number,
	h: number,
): void {
	acc.any = true;
	acc.minX = Math.min(acc.minX, x);
	acc.minY = Math.min(acc.minY, y);
	acc.maxX = Math.max(acc.maxX, x + w);
	acc.maxY = Math.max(acc.maxY, y + h);
}

export function groupBoundsFromMembers(
	doc: PertDoc,
	groupId: GroupId,
	options: GroupBoundsOptions = {},
): Bounds | null {
	const group = doc.groupsById[groupId];
	if (!group) return null;
	const collapsed = options.collapsed ?? EMPTY_GROUP_SET;
	const maxLevel = options.maxLevel ?? Number.POSITIVE_INFINITY;
	const excludeIds = options.excludeIds;

	const acc: BoundsAcc = {
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY,
		any: false,
	};

	const addTask = (taskId: TaskId): void => {
		if (excludeIds?.has(taskId)) return;
		const pos = doc.tasksById[taskId]?.layout?.position;
		if (!pos) return;
		unionRect(acc, pos.x, pos.y, TASK_WIDTH, TASK_HEIGHT);
	};

	// Direct member tasks of this group.
	for (const t of getTasksInGroup(doc, groupId)) addTask(t.id);

	// Child groups: collapsed → card; folded (beyond cap) → members loose;
	// expanded + rendered → recursive box.
	for (const child of getChildGroups(doc, groupId)) {
		if (!isGroupRendered(doc, child.id, maxLevel)) {
			for (const t of getTasksInGroupDeep(doc, child.id)) addTask(t.id);
			continue;
		}
		if (collapsed.has(child.id)) {
			const pos = child.layout?.position ?? { x: 0, y: 0 };
			const w = Math.max(COLLAPSED_CARD_WIDTH, child.layout?.width ?? 0);
			const h = Math.max(COLLAPSED_CARD_HEIGHT, child.layout?.height ?? 0);
			unionRect(acc, pos.x, pos.y, w, h);
			continue;
		}
		const childBounds = groupBoundsFromMembers(doc, child.id, options);
		if (childBounds) {
			unionRect(
				acc,
				childBounds.x,
				childBounds.y,
				childBounds.width,
				childBounds.height,
			);
		}
	}

	if (!acc.any) {
		const ownPos = group.layout?.position ?? { x: 0, y: 0 };
		return {
			x: ownPos.x,
			y: ownPos.y,
			width: group.layout?.width ?? GROUP_MIN_WIDTH,
			height: group.layout?.height ?? GROUP_MIN_HEIGHT,
		};
	}
	return {
		x: acc.minX - GROUP_PAD_X,
		y: acc.minY - GROUP_PAD_TOP,
		width: Math.max(acc.maxX - acc.minX + GROUP_PAD_X * 2, GROUP_MIN_WIDTH),
		height: Math.max(
			acc.maxY - acc.minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
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
// drop-into, so they're skipped — as are groups folded away by the depth cap
// (they have no box to drop into).
export function buildGroupSnapshot(
	doc: PertDoc,
	collapsed: ReadonlySet<GroupId>,
	excludeIds?: ReadonlySet<TaskId>,
	maxLevel: number = Number.POSITIVE_INFINITY,
): GroupSnapshot[] {
	const snap: GroupSnapshot[] = [];
	for (const g of Object.values(doc.groupsById)) {
		if (collapsed.has(g.id)) continue;
		if (!isGroupRendered(doc, g.id, maxLevel)) continue;
		const bounds = groupBoundsFromMembers(doc, g.id, {
			collapsed,
			maxLevel,
			excludeIds,
		});
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

import { getDescendants } from "./hierarchy";
import type { PertDoc, TaskId } from "./types";

// Pure helpers for "drag a task into a container" and "drag a container".
//
// `containerBoundsFromDescendants` computes a container's axis-aligned
// bounding box from the *current* positions of its descendant leaves —
// matches the canvas's render-time logic. We expose it here so drop-target
// detection uses the same coordinates the user sees, even when the doc
// hasn't been re-laid out.

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

const TASK_WIDTH = 200;
const TASK_HEIGHT = 80;
const CONTAINER_PAD_X = 36;
const CONTAINER_PAD_TOP = 44;
const CONTAINER_PAD_BOTTOM = 36;
const CONTAINER_MIN_WIDTH = 440;
const CONTAINER_MIN_HEIGHT = 280;

export function containerBoundsFromDescendants(
	doc: PertDoc,
	containerId: TaskId,
	excludeIds?: ReadonlySet<TaskId>,
): Bounds | null {
	const container = doc.tasksById[containerId];
	if (!container || container.kind !== "container") return null;
	const descendants = getDescendants(doc, containerId);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let any = false;
	for (const id of descendants) {
		if (excludeIds?.has(id)) continue;
		const t = doc.tasksById[id];
		if (!t || t.kind === "container") continue;
		const pos = t.layout?.position;
		if (!pos) continue;
		any = true;
		minX = Math.min(minX, pos.x);
		minY = Math.min(minY, pos.y);
		maxX = Math.max(maxX, pos.x + TASK_WIDTH);
		maxY = Math.max(maxY, pos.y + TASK_HEIGHT);
	}
	if (!any) {
		const ownPos = container.layout?.position ?? { x: 0, y: 0 };
		return {
			x: ownPos.x,
			y: ownPos.y,
			width: CONTAINER_MIN_WIDTH,
			height: CONTAINER_MIN_HEIGHT,
		};
	}
	return {
		x: minX - CONTAINER_PAD_X,
		y: minY - CONTAINER_PAD_TOP,
		width: Math.max(maxX - minX + CONTAINER_PAD_X * 2, CONTAINER_MIN_WIDTH),
		height: Math.max(
			maxY - minY + CONTAINER_PAD_TOP + CONTAINER_PAD_BOTTOM,
			CONTAINER_MIN_HEIGHT,
		),
	};
}

function pointInBounds(p: Point, b: Bounds): boolean {
	return (
		p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
	);
}

// Returns the deepest container whose bounds contain `point`. Skips
// collapsed containers (they render as a single card and shouldn't accept
// drop-into; user collapses to hide, not to nest into).
//
// `excludeIds` lets the caller exclude the currently-dragged task (and its
// descendants) from each container's bounding-box computation. Without that,
// dragging a leaf around inside its own container keeps the container's
// bounds growing with the cursor and the leaf can never escape.
export function findContainerAtPoint(
	doc: PertDoc,
	point: Point,
	collapsed: ReadonlySet<TaskId>,
	excludeIds?: ReadonlySet<TaskId>,
): TaskId | null {
	let best: TaskId | null = null;
	let bestDepth = -1;
	for (const t of Object.values(doc.tasksById)) {
		if (t.kind !== "container") continue;
		if (collapsed.has(t.id)) continue;
		if (excludeIds?.has(t.id)) continue;
		const bounds = containerBoundsFromDescendants(doc, t.id, excludeIds);
		if (!bounds || !pointInBounds(point, bounds)) continue;
		const depth = ancestorDepth(doc, t.id);
		if (depth > bestDepth) {
			best = t.id;
			bestDepth = depth;
		}
	}
	return best;
}

export type ContainerSnapshot = {
	id: TaskId;
	bounds: Bounds;
	depth: number;
};

// Snapshot every drop-eligible container's bounds + ancestor depth in one
// doc walk. Drag-time callers use this to avoid recomputing bounds-from-
// descendants 60 times per second: during a single drag the dragged leaf
// is excluded from each container's bounds, the other descendants don't
// move, so the snapshot stays accurate for the lifetime of the drag.
// Sorted deepest-first so the per-frame hit test can return on first match.
export function buildContainerSnapshot(
	doc: PertDoc,
	collapsed: ReadonlySet<TaskId>,
	excludeIds?: ReadonlySet<TaskId>,
): ContainerSnapshot[] {
	const snap: ContainerSnapshot[] = [];
	for (const t of Object.values(doc.tasksById)) {
		if (t.kind !== "container") continue;
		if (collapsed.has(t.id)) continue;
		if (excludeIds?.has(t.id)) continue;
		const bounds = containerBoundsFromDescendants(doc, t.id, excludeIds);
		if (!bounds) continue;
		snap.push({ id: t.id, bounds, depth: ancestorDepth(doc, t.id) });
	}
	snap.sort((a, b) => b.depth - a.depth);
	return snap;
}

export function findContainerAtPointInSnapshot(
	snapshot: ReadonlyArray<ContainerSnapshot>,
	point: Point,
): TaskId | null {
	for (const s of snapshot) {
		if (pointInBounds(point, s.bounds)) return s.id;
	}
	return null;
}

function ancestorDepth(doc: PertDoc, taskId: TaskId): number {
	let depth = 0;
	let current = doc.tasksById[taskId]?.parentId ?? null;
	const seen = new Set<TaskId>();
	while (current && !seen.has(current)) {
		seen.add(current);
		depth += 1;
		current = doc.tasksById[current]?.parentId ?? null;
	}
	return depth;
}

// Can `taskId` be re-parented into `containerId`? Forbids: self, current
// parent (no-op), descendants (would create a cycle in the hierarchy), and
// non-container targets. `null` containerId means "promote to root", which
// is always allowed (provided the task currently has a parent).
export function canReparent(
	doc: PertDoc,
	taskId: TaskId,
	containerId: TaskId | null,
): boolean {
	const task = doc.tasksById[taskId];
	if (!task) return false;
	const currentParent = task.parentId ?? null;
	if (containerId === currentParent) return false;
	if (containerId === null) return true;
	if (containerId === taskId) return false;
	const target = doc.tasksById[containerId];
	if (!target || target.kind !== "container") return false;
	// Would re-parenting create a cycle in the hierarchy? A task can't be
	// parented under one of its own descendants.
	const descendants = new Set(getDescendants(doc, taskId));
	if (descendants.has(containerId)) return false;
	return true;
}

export function reparentMutation(
	taskId: TaskId,
	containerId: TaskId | null,
): (doc: PertDoc) => void {
	return (doc) => {
		const task = doc.tasksById[taskId];
		if (!task) return;
		task.parentId = containerId;
	};
}

// Shift every descendant leaf's layout.position by (dx, dy). Used when the
// user drags a container — we re-anchor the children so the container's
// bounds-from-descendants computation places it at the dropped location.
export function shiftDescendantsMutation(
	containerId: TaskId,
	dx: number,
	dy: number,
): (doc: PertDoc) => void {
	return (doc) => {
		const ids = getDescendants(doc, containerId);
		for (const id of ids) {
			const t = doc.tasksById[id];
			if (!t || t.kind === "container") continue;
			const pos = t.layout?.position;
			if (!pos) continue;
			t.layout = {
				...(t.layout ?? {}),
				position: { x: pos.x + dx, y: pos.y + dy },
			};
		}
	};
}

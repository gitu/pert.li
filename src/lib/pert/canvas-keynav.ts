import type { PertDoc, TaskId } from "./types";

// Keyboard navigation on the canvas. Arrow keys jump the selection through
// the dependency graph and through visually-aligned siblings:
//
//   Left   → predecessor of the selected task
//   Right  → successor of the selected task
//   Up     → sibling above (sibling = shares a predecessor or a successor)
//   Down   → sibling below
//
// Resolution prefers the candidate closest in y to the source so the user
// follows the graph along the visual lane they were in, not a random branch.
// Containers and missing tasks are ignored — only leaf tasks/milestones are
// valid landing spots, matching what the inspector + canvas actually surface.

export type NavDirection = "left" | "right" | "up" | "down";

export function findNeighborTaskId(
	doc: PertDoc,
	selectedId: TaskId,
	direction: NavDirection,
): TaskId | null {
	const source = doc.tasksById[selectedId];
	if (!source) return null;
	const sourceY = source.layout?.position?.y ?? 0;

	if (direction === "left" || direction === "right") {
		const candidates: TaskId[] = [];
		for (const dep of Object.values(doc.dependenciesById)) {
			const from = dep.from.taskId;
			const to = dep.to.taskId;
			if (!from || !to) continue;
			if (direction === "left" && to === selectedId) candidates.push(from);
			else if (direction === "right" && from === selectedId)
				candidates.push(to);
		}
		return closestByY(doc, candidates, sourceY);
	}

	// up / down — siblings sharing a predecessor or successor with the source.
	const preds = new Set<TaskId>();
	const succs = new Set<TaskId>();
	for (const dep of Object.values(doc.dependenciesById)) {
		const from = dep.from.taskId;
		const to = dep.to.taskId;
		if (!from || !to) continue;
		if (to === selectedId) preds.add(from);
		if (from === selectedId) succs.add(to);
	}
	const siblings = new Set<TaskId>();
	for (const dep of Object.values(doc.dependenciesById)) {
		const from = dep.from.taskId;
		const to = dep.to.taskId;
		if (!from || !to) continue;
		if (preds.has(from) && to !== selectedId) siblings.add(to);
		if (succs.has(to) && from !== selectedId) siblings.add(from);
	}
	return strictlyOffsetByY(
		doc,
		[...siblings],
		sourceY,
		direction === "up" ? "above" : "below",
	);
}

function isLeafKind(doc: PertDoc, id: TaskId): boolean {
	const t = doc.tasksById[id];
	return Boolean(t) && t.kind !== "container";
}

function closestByY(
	doc: PertDoc,
	ids: readonly TaskId[],
	sourceY: number,
): TaskId | null {
	let best: TaskId | null = null;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (const id of ids) {
		if (!isLeafKind(doc, id)) continue;
		const y = doc.tasksById[id].layout?.position?.y ?? 0;
		const diff = Math.abs(y - sourceY);
		if (diff < bestDiff) {
			bestDiff = diff;
			best = id;
		}
	}
	return best;
}

function strictlyOffsetByY(
	doc: PertDoc,
	ids: readonly TaskId[],
	sourceY: number,
	direction: "above" | "below",
): TaskId | null {
	let best: TaskId | null = null;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (const id of ids) {
		if (!isLeafKind(doc, id)) continue;
		const y = doc.tasksById[id].layout?.position?.y ?? 0;
		const diff = direction === "above" ? sourceY - y : y - sourceY;
		if (diff > 0 && diff < bestDiff) {
			bestDiff = diff;
			best = id;
		}
	}
	return best;
}

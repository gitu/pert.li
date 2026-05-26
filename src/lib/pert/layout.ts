import ELK from "elkjs/lib/elk.bundled.js";
import { type LayoutSpacing, SPACING_PRESETS } from "./canvas-prefs";
import type { PertDoc, Task, TaskId } from "./types";

// Auto-layout for the React Flow canvas. We run ELK's "layered" algorithm —
// left-to-right, port-aware — to give tasks sensible positions. The
// behaviour branches on whether the doc contains any containers:
//
//  - Flat (no containers): every leaf is fed as a sibling. Persisted
//    `task.layout.position` values pin in place so newly added tasks slot
//    in around them without disturbing manual drags.
//
//  - Hierarchical (any container present): the graph mirrors `parentId`
//    nesting. ELK lays each container's children out *inside* the
//    container's bounds, then sizes the container around them. We walk the
//    nested result back into root-absolute coordinates because the rest of
//    the canvas stores absolute positions on the doc. Pinning is dropped
//    in this mode — the absolute→relative conversion would be unstable
//    until we move to React Flow sub-flow relative coords, and an
//    explicit re-layout is the normal entry point anyway.

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;
const COLLAPSED_CONTAINER_WIDTH = 220;
const COLLAPSED_CONTAINER_HEIGHT = 80;

const elk = new ELK();

function rootLayoutOptions(spacing: LayoutSpacing): Record<string, string> {
	const preset = SPACING_PRESETS[spacing];
	return {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.layered.spacing.nodeNodeBetweenLayers": String(preset.betweenLayers),
		"elk.spacing.nodeNode": String(preset.nodeNode),
		"elk.spacing.edgeNode": String(preset.edgeNode),
		"elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
		// Edges may cross hierarchy levels (cross-container deps). This option
		// tells ELK to route them through the whole graph instead of giving up.
		"elk.hierarchyHandling": "INCLUDE_CHILDREN",
	};
}

// Per-container layout options — gives every container its own layered
// layout with sensible padding so child nodes don't bleed into the
// container's header strip.
function containerLayoutOptions(
	spacing: LayoutSpacing,
): Record<string, string> {
	const preset = SPACING_PRESETS[spacing];
	return {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.layered.spacing.nodeNodeBetweenLayers": String(preset.betweenLayers),
		"elk.spacing.nodeNode": String(preset.nodeNode),
		// Reserve 36px on the top for the container header (matches
		// CONTAINER_PADDING_TOP in canvas.tsx). Other sides scale with the
		// chosen tightness so compact actually looks compact.
		"elk.padding": `[top=36,left=${preset.edgeNode + 4},bottom=${preset.edgeNode + 4},right=${preset.edgeNode + 4}]`,
	};
}

export type LayoutPosition = { x: number; y: number };

export type LayoutResult = Record<TaskId, LayoutPosition>;

export type ComputeLayoutOptions = {
	/** Spacing preset — defaults to "comfortable". */
	spacing?: LayoutSpacing;
	/**
	 * If true, ignore persisted `task.layout.position` and re-flow every
	 * leaf from scratch. Default false (preserves user-dragged nodes and
	 * only places newcomers). Hierarchical layout always re-flows.
	 */
	forceReflow?: boolean;
	/**
	 * Per-user collapse set. Collapsed containers participate in layout as
	 * a single sized node (their children are hidden from ELK). Defaults to
	 * an empty set if not provided.
	 */
	collapsed?: ReadonlySet<TaskId>;
};

export async function computeLayout(
	doc: PertDoc,
	options: ComputeLayoutOptions = {},
): Promise<LayoutResult> {
	const spacing = options.spacing ?? "comfortable";
	const forceReflow = options.forceReflow ?? false;
	const collapsed = options.collapsed ?? new Set<TaskId>();

	const allTasks = Object.values(doc.tasksById);
	if (allTasks.length === 0) return {};

	const hasContainer = allTasks.some((t) => t.kind === "container");
	if (hasContainer) {
		return computeHierarchicalLayout(doc, spacing, collapsed);
	}
	return computeFlatLayout(doc, spacing, forceReflow);
}

async function computeFlatLayout(
	doc: PertDoc,
	spacing: LayoutSpacing,
	forceReflow: boolean,
): Promise<LayoutResult> {
	const leafTasks = Object.values(doc.tasksById).filter(
		(t) => t.kind !== "container",
	);
	if (leafTasks.length === 0) return {};

	const children = leafTasks.map((t) => ({
		id: t.id,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		...(!forceReflow && t.layout?.position
			? {
					// `elk.position` pins the node at this coordinate so ELK lays
					// out the rest of the graph around it. Skipped when the user
					// explicitly asked for a re-flow.
					layoutOptions: {
						"elk.position": `(${t.layout.position.x},${t.layout.position.y})`,
					},
				}
			: {}),
	}));

	const edges = collectFlatEdges(doc);

	const graph = {
		id: "root",
		layoutOptions: rootLayoutOptions(spacing),
		children,
		edges,
	};

	const laidOut = await elk.layout(graph);
	const positions: LayoutResult = {};
	for (const node of laidOut.children ?? []) {
		const t = doc.tasksById[node.id];
		if (!forceReflow && t?.layout?.position) {
			positions[node.id] = t.layout.position;
			continue;
		}
		positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
	}
	return positions;
}

async function computeHierarchicalLayout(
	doc: PertDoc,
	spacing: LayoutSpacing,
	collapsed: ReadonlySet<TaskId>,
): Promise<LayoutResult> {
	const tasksByParent = new Map<TaskId | null, Task[]>();
	for (const t of Object.values(doc.tasksById)) {
		const key = t.parentId ?? null;
		if (!tasksByParent.has(key)) tasksByParent.set(key, []);
		tasksByParent.get(key)?.push(t);
	}

	function buildNode(t: Task): ElkInputNode {
		// Collapsed containers behave like sized leaves: their children are
		// hidden from the layout altogether, so ELK can route external edges
		// straight to the container card.
		if (t.kind === "container" && !collapsed.has(t.id)) {
			const kids = tasksByParent.get(t.id) ?? [];
			return {
				id: t.id,
				layoutOptions: containerLayoutOptions(spacing),
				children: kids.map(buildNode),
			};
		}
		if (t.kind === "container") {
			return {
				id: t.id,
				width: COLLAPSED_CONTAINER_WIDTH,
				height: COLLAPSED_CONTAINER_HEIGHT,
			};
		}
		return { id: t.id, width: NODE_WIDTH, height: NODE_HEIGHT };
	}

	const rootChildren = (tasksByParent.get(null) ?? []).map(buildNode);

	// Edges with at least one endpoint inside a collapsed container reroute
	// to the container itself (matches the canvas projection). Edges fully
	// inside a collapsed container are dropped.
	const edges: Array<{
		id: string;
		sources: [string];
		targets: [string];
	}> = [];
	for (const dep of Object.values(doc.dependenciesById)) {
		const fromId = dep.from.taskId;
		const toId = dep.to.taskId;
		if (!fromId || !toId) continue;
		if (!doc.tasksById[fromId] || !doc.tasksById[toId]) continue;
		const source = nearestCollapsedOrSelf(doc, fromId, collapsed);
		const target = nearestCollapsedOrSelf(doc, toId, collapsed);
		if (source === target) continue;
		edges.push({ id: dep.id, sources: [source], targets: [target] });
	}

	const graph = {
		id: "root",
		layoutOptions: rootLayoutOptions(spacing),
		children: rootChildren,
		edges,
	};

	const laidOut = await elk.layout(graph);

	// ELK returns nested coords relative to each parent. The canvas stores
	// root-absolute coords, so accumulate offsets on the way down.
	const positions: LayoutResult = {};
	function walk(node: ElkOutputNode, offsetX: number, offsetY: number): void {
		const absX = offsetX + (node.x ?? 0);
		const absY = offsetY + (node.y ?? 0);
		positions[node.id] = { x: absX, y: absY };
		for (const child of node.children ?? []) {
			walk(child, absX, absY);
		}
	}
	for (const root of laidOut.children ?? []) {
		walk(root, 0, 0);
	}
	return positions;
}

function collectFlatEdges(doc: PertDoc) {
	return Object.values(doc.dependenciesById)
		.filter(
			(d) =>
				d.from.taskId &&
				d.to.taskId &&
				doc.tasksById[d.from.taskId]?.kind !== "container" &&
				doc.tasksById[d.to.taskId]?.kind !== "container",
		)
		.map((d) => ({
			id: d.id,
			sources: [d.from.taskId as string],
			targets: [d.to.taskId as string],
		}));
}

function nearestCollapsedOrSelf(
	doc: PertDoc,
	taskId: TaskId,
	collapsed: ReadonlySet<TaskId>,
): TaskId {
	let current: TaskId | null = taskId;
	const seen = new Set<TaskId>();
	while (current) {
		if (seen.has(current)) break;
		seen.add(current);
		if (collapsed.has(current)) return current;
		const t = doc.tasksById[current];
		current = t?.parentId ?? null;
	}
	return taskId;
}

// Minimal ELK node shapes we actually use — keeps us from pulling the full
// elkjs typings in for this small surface.
type ElkInputNode = {
	id: string;
	width?: number;
	height?: number;
	layoutOptions?: Record<string, string>;
	children?: ElkInputNode[];
};
type ElkOutputNode = {
	id: string;
	x?: number;
	y?: number;
	children?: ElkOutputNode[];
};

// Synchronous fallback used when ELK hasn't resolved yet (first paint). Lays
// nodes out in a coarse grid based on insertion order so the canvas never
// flashes with overlapping nodes at (0,0).
//
// Groups children by their parent container so siblings stay clustered. Each
// container gets its own region in the root grid; its descendants fill that
// region as a sub-grid. The expanded-container bounds calc downstream then
// sizes the container around the cluster instead of growing to wrap scattered
// leaves.
export function fallbackGridLayout(doc: PertDoc): LayoutResult {
	const positions: LayoutResult = {};
	const tasksByParent = new Map<TaskId | null, Task[]>();
	for (const t of Object.values(doc.tasksById)) {
		const key = t.parentId ?? null;
		const bucket = tasksByParent.get(key);
		if (bucket) bucket.push(t);
		else tasksByParent.set(key, [t]);
	}

	const colStep = NODE_WIDTH + 80;
	const rowStep = NODE_HEIGHT + 40;
	const REGION_GAP = 60;

	type Region = { width: number; height: number };

	// Lay a single parent's leaf children out as a compact grid, returning
	// the region size. Containers are skipped here — they get their own
	// region; we just leave a sized hole for them by treating them as units.
	function placeLeaves(
		parentId: TaskId | null,
		originX: number,
		originY: number,
	): Region {
		const leaves = (tasksByParent.get(parentId) ?? []).filter(
			(t) => t.kind !== "container",
		);
		if (leaves.length === 0) return { width: 0, height: 0 };
		const cols = Math.max(1, Math.ceil(Math.sqrt(leaves.length)));
		leaves.forEach((t, i) => {
			if (t.layout?.position) {
				positions[t.id] = t.layout.position;
				return;
			}
			positions[t.id] = {
				x: originX + (i % cols) * colStep,
				y: originY + Math.floor(i / cols) * rowStep,
			};
		});
		const rows = Math.ceil(leaves.length / cols);
		return {
			width: cols * colStep,
			height: rows * rowStep,
		};
	}

	// Place every container as its own region under the root grid. Sub-
	// containers within a container nest recursively. Returns the region
	// the container occupies (so callers can grid containers themselves).
	function placeContainerRegion(
		container: Task,
		originX: number,
		originY: number,
	): Region {
		const innerOriginX = originX + NODE_WIDTH / 2;
		const innerOriginY = originY + rowStep / 2;
		const leafRegion = placeLeaves(container.id, innerOriginX, innerOriginY);
		let cursorY = innerOriginY + leafRegion.height + REGION_GAP;
		let maxWidth = leafRegion.width;
		const childContainers = (tasksByParent.get(container.id) ?? []).filter(
			(t) => t.kind === "container",
		);
		for (const child of childContainers) {
			const childRegion = placeContainerRegion(child, innerOriginX, cursorY);
			cursorY += childRegion.height + REGION_GAP;
			if (childRegion.width > maxWidth) maxWidth = childRegion.width;
		}
		return {
			width: maxWidth + NODE_WIDTH,
			height: cursorY - originY + REGION_GAP,
		};
	}

	// Root layout: place root leaves first in the upper-left, then stack
	// each top-level container as its own region to the right of them.
	const rootLeafRegion = placeLeaves(null, 0, 0);
	let cursorX = rootLeafRegion.width + REGION_GAP;
	for (const container of (tasksByParent.get(null) ?? []).filter(
		(t) => t.kind === "container",
	)) {
		const region = placeContainerRegion(container, cursorX, 0);
		cursorX += region.width + REGION_GAP;
	}
	return positions;
}

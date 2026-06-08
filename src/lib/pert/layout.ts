import ELK from "elkjs/lib/elk.bundled.js";
import { type LayoutSpacing, SPACING_PRESETS } from "./canvas-prefs";
import {
	filterCollapsedToRendered,
	getChildGroups,
	getGroupDescendants,
	getNearestCollapsedGroup,
	getTasksInGroup,
	getTasksInGroupDeep,
	isGroupRendered,
} from "./hierarchy";
import type { Group, GroupId, PertDoc } from "./types";

// Auto-layout for the React Flow canvas. We run ELK's "layered" algorithm —
// left-to-right, port-aware — to give tasks sensible positions. The behaviour
// branches on whether the doc contains any groups:
//
//  - Flat (no groups): every task is fed as a sibling. Persisted
//    `task.layout.position` values pin in place so newly added tasks slot in
//    around them without disturbing manual drags.
//
//  - Hierarchical (any group present): the ELK graph mirrors the group tree —
//    each group is an ELK parent node containing its member tasks and nested
//    group nodes. ELK lays each group's members out *inside* the group's
//    bounds, then sizes the group around them. We walk the nested result back
//    into root-absolute coordinates because the rest of the canvas stores
//    absolute positions. Pinning is dropped in this mode — an explicit
//    re-layout is the normal entry point anyway.
//
// The returned map is keyed by id and includes BOTH task ids and group ids:
// callers apply task positions to `task.layout.position` and group positions
// to `group.layout.position` (the anchor for collapsed / empty groups).

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;
const COLLAPSED_GROUP_WIDTH = 220;
const COLLAPSED_GROUP_HEIGHT = 80;

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
		// Edges may cross hierarchy levels (cross-group deps). This option tells
		// ELK to route them through the whole graph instead of giving up.
		"elk.hierarchyHandling": "INCLUDE_CHILDREN",
	};
}

// Per-group layout options — gives every group its own layered layout with
// sensible padding so member nodes don't bleed into the group's header strip.
function groupLayoutOptions(spacing: LayoutSpacing): Record<string, string> {
	const preset = SPACING_PRESETS[spacing];
	return {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.layered.spacing.nodeNodeBetweenLayers": String(preset.betweenLayers),
		"elk.spacing.nodeNode": String(preset.nodeNode),
		// Reserve 36px on the top for the group header. Other sides scale with
		// the chosen tightness so compact actually looks compact.
		"elk.padding": `[top=36,left=${preset.edgeNode + 4},bottom=${preset.edgeNode + 4},right=${preset.edgeNode + 4}]`,
	};
}

export type LayoutPosition = { x: number; y: number };

export type LayoutResult = Record<string, LayoutPosition>;

export type ComputeLayoutOptions = {
	/** Spacing preset — defaults to "comfortable". */
	spacing?: LayoutSpacing;
	/**
	 * If true, ignore persisted `task.layout.position` and re-flow every task
	 * from scratch. Default false (preserves user-dragged nodes and only places
	 * newcomers). Hierarchical layout always re-flows.
	 */
	forceReflow?: boolean;
	/**
	 * Per-user collapse set of GROUP ids. Collapsed groups participate in layout
	 * as a single sized node (their members are hidden from ELK). Defaults to an
	 * empty set if not provided.
	 */
	collapsed?: ReadonlySet<GroupId>;
	/**
	 * Depth cap for group boxes (WBS level, 1-based). Groups deeper than this are
	 * not laid out as ELK parents — their tasks fold into the nearest shown
	 * ancestor. `0` disables grouping entirely (flat layout). Defaults to
	 * `Number.POSITIVE_INFINITY` (all levels).
	 */
	maxLevel?: number;
};

export async function computeLayout(
	doc: PertDoc,
	options: ComputeLayoutOptions = {},
): Promise<LayoutResult> {
	const spacing = options.spacing ?? "comfortable";
	const forceReflow = options.forceReflow ?? false;
	const collapsed = options.collapsed ?? new Set<GroupId>();
	const maxLevel = options.maxLevel ?? Number.POSITIVE_INFINITY;

	const allTasks = Object.values(doc.tasksById);
	if (allTasks.length === 0 && Object.keys(doc.groupsById).length === 0) {
		return {};
	}

	// Grouping off (cap 0) lays the graph out flat — no group boxes at all.
	const hasGroups = Object.keys(doc.groupsById).length > 0;
	if (hasGroups && maxLevel >= 1) {
		return computeHierarchicalLayout(doc, spacing, collapsed, maxLevel);
	}
	return computeFlatLayout(doc, spacing, forceReflow);
}

async function computeFlatLayout(
	doc: PertDoc,
	spacing: LayoutSpacing,
	forceReflow: boolean,
): Promise<LayoutResult> {
	const tasks = Object.values(doc.tasksById);
	if (tasks.length === 0) return {};

	const children = tasks.map((t) => ({
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
	rawCollapsed: ReadonlySet<GroupId>,
	maxLevel: number,
): Promise<LayoutResult> {
	// Collapse only applies to groups rendered under the cap — a folded-away
	// group has no ELK node, so its members mustn't hide and its edges mustn't
	// reroute to it.
	const collapsed = filterCollapsedToRendered(doc, rawCollapsed, maxLevel);
	const placed = new Set<string>();

	// Mark a folded (beyond-cap) group subtree as placed so the promote/straggler
	// loops below don't try to give it a position — it renders no box.
	function markGroupTreePlaced(groupId: GroupId): void {
		placed.add(groupId);
		for (const d of getGroupDescendants(doc, groupId)) placed.add(d);
	}

	function buildGroupNode(group: Group): ElkInputNode | null {
		if (placed.has(group.id)) return null;
		// Groups beyond the depth cap don't render as boxes — they're folded by
		// the caller, never laid out as ELK parents.
		if (!isGroupRendered(doc, group.id, maxLevel)) return null;
		placed.add(group.id);
		// Collapsed groups behave like sized leaves: their members are hidden
		// from the layout so ELK can route external edges straight to the card.
		if (collapsed.has(group.id)) {
			return {
				id: group.id,
				width: COLLAPSED_GROUP_WIDTH,
				height: COLLAPSED_GROUP_HEIGHT,
			};
		}
		const children: ElkInputNode[] = [];
		const addTask = (id: string): void => {
			if (placed.has(id)) return;
			placed.add(id);
			children.push({ id, width: NODE_WIDTH, height: NODE_HEIGHT });
		};
		for (const t of getTasksInGroup(doc, group.id)) addTask(t.id);
		for (const child of getChildGroups(doc, group.id)) {
			if (isGroupRendered(doc, child.id, maxLevel)) {
				const node = buildGroupNode(child);
				if (node) children.push(node);
			} else {
				// Fold the over-deep subtree: its tasks render loose inside THIS
				// box; the subtree's groups get no node.
				for (const t of getTasksInGroupDeep(doc, child.id)) addTask(t.id);
				markGroupTreePlaced(child.id);
			}
		}
		return {
			id: group.id,
			layoutOptions: groupLayoutOptions(spacing),
			children,
		};
	}

	const rootChildren: ElkInputNode[] = [];
	for (const group of getChildGroups(doc, null)) {
		const node = buildGroupNode(group);
		if (node) rootChildren.push(node);
	}
	// Ungrouped tasks (or tasks pointing at a missing group) sit at the root.
	for (const t of Object.values(doc.tasksById)) {
		if (placed.has(t.id)) continue;
		const gid = t.groupId ?? null;
		if (gid && doc.groupsById[gid]) continue; // belongs to a (reachable) group
		placed.add(t.id);
		rootChildren.push({ id: t.id, width: NODE_WIDTH, height: NODE_HEIGHT });
	}
	// Promote any groups unreachable from the root (parentGroupId cycle) so they
	// — and their members — still get a position.
	for (const group of Object.values(doc.groupsById)) {
		const node = buildGroupNode(group);
		if (node) rootChildren.push(node);
	}
	// Any tasks still unplaced (member of a promoted/cyclic group already
	// handled, or otherwise stranded) land at the root.
	for (const t of Object.values(doc.tasksById)) {
		if (placed.has(t.id)) continue;
		placed.add(t.id);
		rootChildren.push({ id: t.id, width: NODE_WIDTH, height: NODE_HEIGHT });
	}

	// Edges with at least one endpoint inside a collapsed group reroute to the
	// group itself (matches the canvas projection). Fully-internal edges drop.
	const edges: Array<{ id: string; sources: [string]; targets: [string] }> = [];
	for (const dep of Object.values(doc.dependenciesById)) {
		const fromId = dep.from.taskId;
		const toId = dep.to.taskId;
		if (!fromId || !toId) continue;
		if (!doc.tasksById[fromId] || !doc.tasksById[toId]) continue;
		const source = getNearestCollapsedGroup(doc, fromId, collapsed) ?? fromId;
		const target = getNearestCollapsedGroup(doc, toId, collapsed) ?? toId;
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
				doc.tasksById[d.from.taskId] &&
				doc.tasksById[d.to.taskId],
		)
		.map((d) => ({
			id: d.id,
			sources: [d.from.taskId as string],
			targets: [d.to.taskId as string],
		}));
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
// flashes with overlapping nodes at (0,0). Ungrouped tasks fill the upper-left;
// each root group is placed as its own region to the right, with members and
// nested groups gridded inside it.
export function fallbackGridLayout(doc: PertDoc): LayoutResult {
	const positions: LayoutResult = {};
	const placed = new Set<string>();

	const colStep = NODE_WIDTH + 80;
	const rowStep = NODE_HEIGHT + 40;
	const REGION_GAP = 60;

	type Region = { width: number; height: number };

	function placeTasks(
		groupId: GroupId | null,
		originX: number,
		originY: number,
	): Region {
		const tasks =
			groupId === null
				? Object.values(doc.tasksById).filter((t) => {
						const gid = t.groupId ?? null;
						return !(gid && doc.groupsById[gid]);
					})
				: getTasksInGroup(doc, groupId);
		const fresh = tasks.filter((t) => !placed.has(t.id));
		if (fresh.length === 0) return { width: 0, height: 0 };
		const cols = Math.max(1, Math.ceil(Math.sqrt(fresh.length)));
		fresh.forEach((t, i) => {
			placed.add(t.id);
			if (t.layout?.position) {
				positions[t.id] = t.layout.position;
				return;
			}
			positions[t.id] = {
				x: originX + (i % cols) * colStep,
				y: originY + Math.floor(i / cols) * rowStep,
			};
		});
		const rows = Math.ceil(fresh.length / cols);
		return { width: cols * colStep, height: rows * rowStep };
	}

	function placeGroupRegion(
		group: Group,
		originX: number,
		originY: number,
	): Region {
		if (placed.has(group.id)) return { width: 0, height: 0 };
		placed.add(group.id);
		positions[group.id] = { x: originX, y: originY };
		const innerOriginX = originX + NODE_WIDTH / 2;
		const innerOriginY = originY + rowStep / 2;
		const leafRegion = placeTasks(group.id, innerOriginX, innerOriginY);
		let cursorY = innerOriginY + leafRegion.height + REGION_GAP;
		let maxWidth = leafRegion.width;
		for (const child of getChildGroups(doc, group.id)) {
			const childRegion = placeGroupRegion(child, innerOriginX, cursorY);
			cursorY += childRegion.height + REGION_GAP;
			if (childRegion.width > maxWidth) maxWidth = childRegion.width;
		}
		return {
			width: maxWidth + NODE_WIDTH,
			height: cursorY - originY + REGION_GAP,
		};
	}

	const rootLeafRegion = placeTasks(null, 0, 0);
	let cursorX = rootLeafRegion.width + REGION_GAP;
	for (const group of getChildGroups(doc, null)) {
		const region = placeGroupRegion(group, cursorX, 0);
		cursorX += region.width + REGION_GAP;
	}
	// Promote groups unreachable from root (cycles) so nothing is dropped.
	for (const group of Object.values(doc.groupsById)) {
		if (placed.has(group.id)) continue;
		const region = placeGroupRegion(group, cursorX, 0);
		cursorX += region.width + REGION_GAP;
	}
	return positions;
}

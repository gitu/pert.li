import ELK from "elkjs/lib/elk.bundled.js";
import { type LayoutSpacing, SPACING_PRESETS } from "./canvas-prefs";
import type { PertDoc, TaskId } from "./types";

// Auto-layout for the React Flow canvas. We run ELK's "layered" algorithm —
// left-to-right, port-aware — to give freshly created tasks a sensible
// position. Tasks the user has already dragged keep their persisted position
// (Automerge stores it on `task.layout.position`), so layout never clobbers
// hand-tuned graphs.

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;

const elk = new ELK();

function layoutOptions(spacing: LayoutSpacing): Record<string, string> {
	const preset = SPACING_PRESETS[spacing];
	return {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.layered.spacing.nodeNodeBetweenLayers": String(preset.betweenLayers),
		"elk.spacing.nodeNode": String(preset.nodeNode),
		"elk.spacing.edgeNode": String(preset.edgeNode),
		"elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
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
	 * only places newcomers).
	 */
	forceReflow?: boolean;
};

// Returns positions for every leaf task. Persisted positions on
// `task.layout.position` are returned as-is; everything else is fed through
// ELK so layout still respects the existing pinned nodes when arranging
// new neighbours around them.
export async function computeLayout(
	doc: PertDoc,
	options: ComputeLayoutOptions = {},
): Promise<LayoutResult> {
	const spacing = options.spacing ?? "comfortable";
	const forceReflow = options.forceReflow ?? false;
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
					// `elk.position` pins the node at this coordinate so ELK lays out
					// the rest of the graph around it. When the user explicitly asked
					// for a re-flow we skip this so every node is free to move.
					layoutOptions: {
						"elk.position": `(${t.layout.position.x},${t.layout.position.y})`,
					},
				}
			: {}),
	}));

	const edges = Object.values(doc.dependenciesById)
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

	const graph = {
		id: "root",
		layoutOptions: layoutOptions(spacing),
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

// Synchronous fallback used when ELK hasn't resolved yet (first paint). Lays
// nodes out in a coarse grid based on insertion order so the canvas never
// flashes with overlapping nodes at (0,0).
export function fallbackGridLayout(doc: PertDoc): LayoutResult {
	const cols = 4;
	const colStep = NODE_WIDTH + 80;
	const rowStep = NODE_HEIGHT + 40;
	const positions: LayoutResult = {};
	let i = 0;
	for (const t of Object.values(doc.tasksById)) {
		if (t.kind === "container") continue;
		if (t.layout?.position) {
			positions[t.id] = t.layout.position;
		} else {
			positions[t.id] = {
				x: (i % cols) * colStep,
				y: Math.floor(i / cols) * rowStep,
			};
		}
		i += 1;
	}
	return positions;
}

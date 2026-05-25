import {
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	type Connection,
	Controls,
	type Edge,
	type EdgeChange,
	MiniMap,
	type Node,
	type NodeChange,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	EDGE_STYLE_TO_REACT_FLOW_TYPE,
	type EdgeStyle,
	type LayoutSpacing,
	setEdgeStyle,
	setLayoutSpacing,
	useCanvasPrefs,
} from "#/lib/pert/canvas-prefs";
import { toggleCollapse, useCollapsedSet } from "#/lib/pert/collapse";
import { cycleEdgeSet, cycleTaskSet } from "#/lib/pert/cycle";
import {
	ensureContainerInterfaces,
	removeContainerInterfaces,
} from "#/lib/pert/interfaces";
import { computeLayout, fallbackGridLayout } from "#/lib/pert/layout";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import { type ProjectedNode, projectGraph } from "#/lib/pert/projection";
import {
	canReparent,
	findContainerAtPoint,
	reparentMutation,
	shiftDescendantsMutation,
} from "#/lib/pert/reparent";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import type { PertDoc, Task, TaskId } from "#/lib/pert/types";
import { useMonteCarlo } from "#/lib/pert/use-monte-carlo";
import { useResolvedTheme } from "#/lib/theme";
import { useIsMobile } from "#/lib/use-media-query";
import {
	ContainerCollapsedNode,
	ContainerExpandedNode,
	type ContainerNodeData,
} from "./container-node";
import { CycleBanner } from "./cycle-banner";
import { TaskNode, type TaskNodeData } from "./task-node";
import { CanvasToolbar } from "./toolbar";

export type CanvasProps = {
	projectId: string;
	doc: PertDoc;
	changeDoc: (mutate: (doc: PertDoc) => void) => void;
};

export function PertCanvas(props: CanvasProps) {
	return (
		<ReactFlowProvider>
			<CanvasInner {...props} />
		</ReactFlowProvider>
	);
}

const nodeTypes = {
	task: TaskNode,
	containerCollapsed: ContainerCollapsedNode,
	containerExpanded: ContainerExpandedNode,
};

const TASK_WIDTH = 200;
const TASK_HEIGHT = 80;
const CONTAINER_PADDING_X = 24;
const CONTAINER_PADDING_TOP = 36; // header height
const CONTAINER_PADDING_BOTTOM = 24;
const CONTAINER_MIN_WIDTH = 280;
const CONTAINER_MIN_HEIGHT = 160;

function CanvasInner({ projectId, doc, changeDoc }: CanvasProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const prefs = useCanvasPrefs(projectId);
	const collapsedSet = useCollapsedSet(projectId);
	useAutoLayout(doc, changeDoc, prefs.spacing, collapsedSet);

	const handleRelayout = useCallback(async () => {
		const positions = await computeLayout(doc, {
			spacing: prefs.spacing,
			forceReflow: true,
			collapsed: collapsedSet,
		});
		changeDoc((d) => {
			for (const task of Object.values(d.tasksById)) {
				const pos = positions[task.id];
				if (!pos) continue;
				// Expanded containers derive their position from their
				// children's bounds at render time, so writing a position on
				// them is harmless. Collapsed containers + leaf tasks rely
				// on this stored position to render.
				task.layout = { ...(task.layout ?? {}), position: pos };
			}
		});
	}, [doc, changeDoc, prefs.spacing, collapsedSet]);

	const handleSetEdgeStyle = useCallback(
		(style: EdgeStyle) => setEdgeStyle(projectId, style),
		[projectId],
	);
	const handleSetSpacing = useCallback(
		(spacing: LayoutSpacing) => setLayoutSpacing(projectId, spacing),
		[projectId],
	);

	const projection = useMemo(
		() => projectGraph(doc, scheduleResult, collapsedSet),
		[doc, scheduleResult, collapsedSet],
	);

	const cycle = scheduleResult.ok ? null : scheduleResult.cycle;
	const cycleTaskIds = useMemo(
		() => (cycle ? cycleTaskSet(cycle) : new Set<TaskId>()),
		[cycle],
	);
	const cycleEdgeIds = useMemo(
		() => (cycle ? cycleEdgeSet(doc, cycle) : new Set<string>()),
		[doc, cycle],
	);

	const onContainerToggle = useCallback(
		(taskId: TaskId) => {
			// Capture the expanded bounds-position into the doc before collapsing
			// so the collapsed card lands at the same spot users last saw it.
			if (!collapsedSet.has(taskId)) {
				const bounds = computeExpandedContainerBounds(doc, taskId);
				if (bounds) {
					changeDoc((d) => {
						const task = d.tasksById[taskId];
						if (!task) return;
						task.layout = {
							...(task.layout ?? {}),
							position: { x: bounds.x, y: bounds.y },
						};
					});
				}
			}
			toggleCollapse(projectId, taskId);
		},
		[changeDoc, collapsedSet, doc, projectId],
	);

	const mc = useMonteCarlo(doc, { trials: 1500 });
	const derivedNodes = useMemo(
		() =>
			buildNodes(
				doc,
				projection,
				scheduleResult,
				onContainerToggle,
				cycleTaskIds,
				mc.result,
			),
		[
			doc,
			projection,
			scheduleResult,
			onContainerToggle,
			cycleTaskIds,
			mc.result,
		],
	);
	const derivedEdges = useMemo(
		() => buildEdges(projection, cycleEdgeIds, prefs.edgeStyle),
		[projection, cycleEdgeIds, prefs.edgeStyle],
	);

	// React Flow's local node/edge state. We sync the doc-derived values into
	// this on every doc change while preserving React Flow's view-only fields
	// (selected, dragging) so user interactions don't get squashed.
	const [nodes, setNodes] = useState<Node[]>(derivedNodes);
	const [edges, setEdges] = useState<Edge[]>(derivedEdges);
	// Edge selection is canvas-local — the inspector doesn't surface edges, so
	// there's no reason to lift it into the cross-component selectionStore.
	// Tracking it here lets the toolbar's Delete button target the selected
	// edge (mirroring what the Backspace/Delete key already does via
	// `onEdgesChange` + `deleteKeyCode`).
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

	useEffect(() => {
		setNodes((prev) => mergeNodes(prev, derivedNodes));
	}, [derivedNodes]);
	useEffect(() => {
		setEdges((prev) => mergeEdges(prev, derivedEdges));
	}, [derivedEdges]);

	const lastCommittedPosition = useRef<Map<TaskId, { x: number; y: number }>>(
		new Map(),
	);
	// Per-node snapshot at drag-start. Lets us derive the (dx, dy) delta for
	// container drags (children need to follow) and skip no-op leaf drops.
	const dragStartPositions = useRef<Map<TaskId, { x: number; y: number }>>(
		new Map(),
	);

	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			setNodes((current) => applyNodeChanges(changes, current));
			for (const change of changes) {
				if (change.type !== "position" || !change.position) {
					if (change.type === "remove") {
						removeTaskFromDoc(changeDoc, change.id);
					} else if (change.type === "select" && change.selected) {
						// Only mirror "selected: true" into our store. React Flow can
						// fire `selected: false` for reasons unrelated to user intent
						// (resize during fullscreen toggle, node-list re-syncs), and
						// silently clearing the selection there hides the fullscreen
						// inspector popup. Explicit deselection lives in onPaneClick.
						selectTask(projectId, change.id);
						setSelectedEdgeId(null);
					}
					continue;
				}

				const task = doc.tasksById[change.id];
				const isContainer = task?.kind === "container";

				if (change.dragging === true) {
					if (!dragStartPositions.current.has(change.id)) {
						dragStartPositions.current.set(change.id, {
							x: change.position.x,
							y: change.position.y,
						});
					}
					continue;
				}

				if (change.dragging !== false) continue;

				const seen = lastCommittedPosition.current.get(change.id);
				if (
					seen &&
					seen.x === change.position.x &&
					seen.y === change.position.y
				) {
					dragStartPositions.current.delete(change.id);
					continue;
				}
				const next = { x: change.position.x, y: change.position.y };
				lastCommittedPosition.current.set(change.id, next);

				const start = dragStartPositions.current.get(change.id);
				dragStartPositions.current.delete(change.id);

				if (isContainer) {
					// Drag a container: shift every descendant leaf by the same
					// delta so the bounds-from-children calc re-anchors the
					// container at the dropped location next render.
					if (!start) continue;
					const dx = next.x - start.x;
					const dy = next.y - start.y;
					if (dx === 0 && dy === 0) continue;
					changeDoc(shiftDescendantsMutation(change.id, dx, dy));
					continue;
				}

				// Leaf task: write position, and possibly re-parent if it was
				// dropped inside a container's bounds.
				changeDoc((d) => {
					const draft = d.tasksById[change.id];
					if (!draft) return;
					draft.layout = { ...(draft.layout ?? {}), position: next };
				});
				const targetContainer = findContainerAtPoint(
					doc,
					{
						x: next.x + TASK_WIDTH / 2,
						y: next.y + TASK_HEIGHT / 2,
					},
					collapsedSet,
				);
				if (
					targetContainer !== null &&
					canReparent(doc, change.id, targetContainer)
				) {
					changeDoc(reparentMutation(change.id, targetContainer));
				} else if (
					targetContainer === null &&
					task?.parentId &&
					canReparent(doc, change.id, null)
				) {
					// Dropped outside any container — promote back to root if it
					// was previously nested.
					changeDoc(reparentMutation(change.id, null));
				}
			}
		},
		[changeDoc, doc, projectId, collapsedSet],
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			setEdges((current) => applyEdgeChanges(changes, current));
			for (const change of changes) {
				if (change.type === "remove") {
					changeDoc((d) => {
						delete d.dependenciesById[change.id];
					});
					setSelectedEdgeId((id) => (id === change.id ? null : id));
				} else if (change.type === "select" && change.selected) {
					// Mirror the node-selection pattern: only react to explicit
					// "selected: true" events. Clear any task selection so the
					// inspector doesn't fight the edge selection visually.
					setSelectedEdgeId(change.id);
					selectTask(projectId, null);
				}
			}
		},
		[changeDoc, projectId],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) return;
			if (connection.source === connection.target) return;
			const fromId = connection.source;
			const toId = connection.target;
			changeDoc((d) => {
				if (!d.tasksById[fromId] || !d.tasksById[toId]) return;
				for (const existing of Object.values(d.dependenciesById)) {
					if (existing.from.taskId === fromId && existing.to.taskId === toId) {
						return;
					}
				}
				const id = newId("dep");
				d.dependenciesById[id] = {
					id,
					from: { taskId: fromId },
					to: { taskId: toId },
					type: "finish_to_start",
				};
			});
		},
		[changeDoc],
	);

	const { screenToFlowPosition } = useReactFlow();
	const onPaneClick = useCallback(() => {
		selectTask(projectId, null);
		setSelectedEdgeId(null);
	}, [projectId]);

	const onPaneDoubleClick = useCallback(
		(event: React.MouseEvent) => {
			const position = screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			});
			createTask(changeDoc, "task", position, null, (id) =>
				selectTask(projectId, id),
			);
		},
		[changeDoc, projectId, screenToFlowPosition],
	);

	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	const handleAddTask = useCallback(
		(kind: Task["kind"]) => {
			const center = screenToFlowPosition({
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
			});
			// If a container is currently selected and the new task isn't itself
			// a container, drop it inside.
			const selected = selectedTaskId
				? doc.tasksById[selectedTaskId]
				: undefined;
			const parentId =
				selected?.kind === "container" && kind !== "container"
					? selected.id
					: null;
			createTask(changeDoc, kind, center, parentId, (id) =>
				selectTask(projectId, id),
			);
		},
		[changeDoc, doc.tasksById, projectId, screenToFlowPosition, selectedTaskId],
	);

	const handleDeleteSelected = useCallback(() => {
		// Prefer the edge — when both a task and an edge are somehow selected
		// (transient race after a click), the edge is what the user most
		// recently interacted with via the toolbar Delete affordance.
		if (selectedEdgeId) {
			changeDoc((d) => {
				delete d.dependenciesById[selectedEdgeId];
			});
			setSelectedEdgeId(null);
			setEdges((current) => current.filter((e) => e.id !== selectedEdgeId));
			return;
		}
		if (!selectedTaskId) return;
		removeTaskFromDoc(changeDoc, selectedTaskId);
		selectTask(projectId, null);
	}, [changeDoc, projectId, selectedEdgeId, selectedTaskId]);

	useEffect(() => {
		return () => {
			selectTask(projectId, null);
		};
	}, [projectId]);

	const resolvedTheme = useResolvedTheme();
	const isMobile = useIsMobile();

	return (
		<div className="relative h-full w-full bg-background">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={onConnect}
				onPaneClick={onPaneClick}
				onPaneContextMenu={(e) => e.preventDefault()}
				onDoubleClick={onPaneDoubleClick}
				fitView
				// React Flow's auto-fit slightly over-zooms on phone-sized
				// viewports — small projects render at near 1×, hiding nearby
				// nodes off-screen. A lower minimum lets two-finger pinch zoom
				// out far enough to see the whole graph at once.
				minZoom={isMobile ? 0.2 : 0.5}
				deleteKeyCode={["Backspace", "Delete"]}
				className="bg-background"
				colorMode={resolvedTheme}
				proOptions={{ hideAttribution: true }}
			>
				<Background gap={20} size={1} />
				{/* The default Controls strip overlaps the mobile bottom nav and
				    isn't needed on touch where pinch + drag work natively. The
				    MiniMap likewise eats 25% of a phone viewport. */}
				{!isMobile && <Controls showInteractive={false} />}
				{!isMobile && (
					<MiniMap pannable zoomable className="!border !bg-card" />
				)}
			</ReactFlow>
			<div
				// Cap the toolbar's width to the canvas viewport minus a small
				// margin so its inner row can actually wrap on narrow screens.
				// Without this the toolbar's intrinsic width stays wider than
				// the viewport and overflows / clips on mobile.
				className="pointer-events-none absolute top-3 left-1/2 z-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2"
			>
				<div className="pointer-events-auto">
					<CanvasToolbar
						onAddTask={() => handleAddTask("task")}
						onAddMilestone={() => handleAddTask("milestone")}
						onAddContainer={() => handleAddTask("container")}
						onDeleteSelected={
							selectedTaskId || selectedEdgeId
								? handleDeleteSelected
								: undefined
						}
						prefs={prefs}
						onSetEdgeStyle={handleSetEdgeStyle}
						onSetSpacing={handleSetSpacing}
						onRelayout={handleRelayout}
					/>
				</div>
			</div>
			{cycle && (
				<div className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2">
					<CycleBanner
						projectId={projectId}
						doc={doc}
						cycle={cycle}
						changeDoc={changeDoc}
					/>
				</div>
			)}
			{Object.keys(doc.tasksById).length === 0 && <CanvasEmptyState />}
		</div>
	);
}

function CanvasEmptyState() {
	return (
		<div className="pointer-events-none absolute inset-0 z-0 grid place-items-center text-center text-sm text-muted-foreground">
			<div className="max-w-sm space-y-1">
				<p className="font-medium text-foreground">No tasks yet.</p>
				<p>Double-click the canvas to add a task, or use the toolbar above.</p>
			</div>
		</div>
	);
}

function mergeNodes(prev: Node[], next: Node[]): Node[] {
	const prevById = new Map(prev.map((n) => [n.id, n]));
	return next.map((n) => {
		const old = prevById.get(n.id);
		if (!old) return n;
		return {
			...n,
			selected: old.selected,
			dragging: old.dragging,
			position: old.dragging ? old.position : n.position,
		};
	});
}

function mergeEdges(prev: Edge[], next: Edge[]): Edge[] {
	const prevById = new Map(prev.map((e) => [e.id, e]));
	return next.map((e) => {
		const old = prevById.get(e.id);
		if (!old) return e;
		return { ...e, selected: old.selected };
	});
}

function buildNodes(
	doc: PertDoc,
	projection: ReturnType<typeof projectGraph>,
	scheduleResult: ReturnType<typeof computeSchedule>,
	onToggleContainer: (taskId: TaskId) => void,
	cycleTaskIds: ReadonlySet<TaskId>,
	mcResult: MonteCarloResult | null,
): Node[] {
	const fallback = fallbackGridLayout(doc);
	const schedule = scheduleResult.ok ? scheduleResult.schedule : null;
	const nodes: Node[] = [];

	for (const projected of projection.nodes) {
		if (projected.kind === "container-expanded") {
			const bounds = computeExpandedContainerBoundsFromDoc(
				doc,
				projected.task.id,
				fallback,
			) ?? {
				x: projected.task.layout?.position?.x ?? 0,
				y: projected.task.layout?.position?.y ?? 0,
				width: CONTAINER_MIN_WIDTH,
				height: CONTAINER_MIN_HEIGHT,
			};
			const data: ContainerNodeData = {
				title: projected.task.title,
				rollup: null,
				collapsed: false,
				onToggle: () => onToggleContainer(projected.task.id),
			};
			nodes.push({
				id: projected.task.id,
				type: "containerExpanded",
				position: { x: bounds.x, y: bounds.y },
				data: data as unknown as Record<string, unknown>,
				width: bounds.width,
				height: bounds.height,
				// Sit above leaves so the header strip is always clickable; the
				// container body uses pointer-events: none so leaves underneath
				// still receive clicks normally.
				zIndex: 10,
				// Drag is enabled now — the header strip is the drag handle
				// (canvas's container-node component carries the `nodrag` class
				// on the body so leaves inside still receive clicks/drags).
				draggable: true,
				selectable: true,
				focusable: true,
			});
		} else if (projected.kind === "container-collapsed") {
			const pos = projected.task.layout?.position ??
				fallback[projected.task.id] ?? { x: 0, y: 0 };
			const data: ContainerNodeData = {
				title: projected.task.title,
				rollup: projected.rollup,
				collapsed: true,
				onToggle: () => onToggleContainer(projected.task.id),
			};
			nodes.push({
				id: projected.task.id,
				type: "containerCollapsed",
				position: pos,
				data: data as unknown as Record<string, unknown>,
				width: 220,
				height: 80,
				zIndex: 1,
			});
		} else {
			pushLeafNode(
				nodes,
				projected,
				doc,
				fallback,
				schedule,
				cycleTaskIds,
				mcResult,
			);
		}
	}

	return nodes;
}

function pushLeafNode(
	nodes: Node[],
	projected: Extract<ProjectedNode, { kind: "leaf" }>,
	_doc: PertDoc,
	fallback: ReturnType<typeof fallbackGridLayout>,
	schedule: ReturnType<typeof computeSchedule> extends {
		ok: true;
		schedule: infer S;
	}
		? S | null
		: never,
	cycleTaskIds: ReadonlySet<TaskId>,
	mcResult: MonteCarloResult | null,
) {
	const task = projected.task;
	const pos = task.layout?.position ?? fallback[task.id] ?? { x: 0, y: 0 };
	const sched = schedule?.tasks[task.id];
	const mcTask = mcResult?.tasks[task.id];
	const data: TaskNodeData = {
		title: task.title,
		kind: task.kind === "milestone" ? "milestone" : "task",
		durationDays: sched?.duration ?? 0,
		slackDays: sched?.slack ?? null,
		critical: sched?.critical ?? false,
		hasEstimate: Boolean(task.estimate),
		cycle: cycleTaskIds.has(task.id),
		status: sched?.status ?? task.status ?? "not_started",
		progress: sched?.progress ?? task.progress ?? 0,
		criticality: mcTask?.criticality,
	};
	nodes.push({
		id: task.id,
		type: "task",
		position: pos,
		data: data as unknown as Record<string, unknown>,
		width: TASK_WIDTH,
		height: TASK_HEIGHT,
		zIndex: 1,
	});
}

function buildEdges(
	projection: ReturnType<typeof projectGraph>,
	cycleEdgeIds: ReadonlySet<string>,
	edgeStyle: EdgeStyle,
): Edge[] {
	const reactFlowType = EDGE_STYLE_TO_REACT_FLOW_TYPE[edgeStyle];
	return projection.edges.map((edge) => {
		const onCycle = cycleEdgeIds.has(edge.id);
		// Cycle edges win over critical styling — the cycle is the user's
		// blocking problem; the critical-path overlay is moot until it's
		// resolved.
		const style = onCycle
			? {
					stroke: "var(--destructive)",
					strokeWidth: 2.25,
					strokeDasharray: "8 4",
				}
			: edge.critical
				? { stroke: "var(--destructive)", strokeWidth: 2 }
				: edge.rerouted
					? {
							stroke: "var(--muted-foreground)",
							strokeWidth: 1.25,
							strokeDasharray: "6 4",
						}
					: { stroke: "var(--muted-foreground)", strokeWidth: 1.25 };
		return {
			id: edge.id,
			source: edge.source,
			target: edge.target,
			type: reactFlowType,
			animated: edge.critical || onCycle,
			style,
			data: { onCycle },
		};
	});
}

// Bounding box around every visible leaf descendant of a container, in flow
// coordinates. Returns null when nothing is positioned yet.
function computeExpandedContainerBoundsFromDoc(
	doc: PertDoc,
	containerId: TaskId,
	fallback: ReturnType<typeof fallbackGridLayout>,
): { x: number; y: number; width: number; height: number } | null {
	const queue: TaskId[] = [containerId];
	const seen = new Set<TaskId>([containerId]);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let anyDescendant = false;
	while (queue.length > 0) {
		const current = queue.shift() as TaskId;
		for (const t of Object.values(doc.tasksById)) {
			if ((t.parentId ?? null) !== current) continue;
			if (seen.has(t.id)) continue;
			seen.add(t.id);
			queue.push(t.id);
			anyDescendant = true;
			if (t.kind === "container") continue;
			const pos = t.layout?.position ?? fallback[t.id] ?? { x: 0, y: 0 };
			minX = Math.min(minX, pos.x);
			minY = Math.min(minY, pos.y);
			maxX = Math.max(maxX, pos.x + TASK_WIDTH);
			maxY = Math.max(maxY, pos.y + TASK_HEIGHT);
		}
	}
	if (!anyDescendant || !Number.isFinite(minX)) {
		const ownPos = doc.tasksById[containerId]?.layout?.position ?? {
			x: 0,
			y: 0,
		};
		return {
			x: ownPos.x,
			y: ownPos.y,
			width: CONTAINER_MIN_WIDTH,
			height: CONTAINER_MIN_HEIGHT,
		};
	}
	const padX = CONTAINER_PADDING_X;
	const padTop = CONTAINER_PADDING_TOP;
	const padBottom = CONTAINER_PADDING_BOTTOM;
	const width = Math.max(maxX - minX + padX * 2, CONTAINER_MIN_WIDTH);
	const height = Math.max(
		maxY - minY + padTop + padBottom,
		CONTAINER_MIN_HEIGHT,
	);
	return {
		x: minX - padX,
		y: minY - padTop,
		width,
		height,
	};
}

// Public-style helper for the collapse handler — same bounds, but returns
// just the top-left we want to anchor the collapsed card at.
function computeExpandedContainerBounds(
	doc: PertDoc,
	containerId: TaskId,
): { x: number; y: number } | null {
	const fallback = fallbackGridLayout(doc);
	const bounds = computeExpandedContainerBoundsFromDoc(
		doc,
		containerId,
		fallback,
	);
	if (!bounds) return null;
	return { x: bounds.x, y: bounds.y };
}

function useAutoLayout(
	doc: PertDoc,
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	spacing: LayoutSpacing,
	collapsed: ReadonlySet<TaskId>,
) {
	useEffect(() => {
		const tasks = Object.values(doc.tasksById);
		const missing = tasks.filter(
			(t) => t.kind !== "container" && !t.layout?.position,
		);
		if (missing.length === 0) return;
		let cancelled = false;
		computeLayout(doc, { spacing, collapsed }).then((positions) => {
			if (cancelled) return;
			changeDoc((d) => {
				for (const task of Object.values(d.tasksById)) {
					if (task.kind === "container") continue;
					if (task.layout?.position) continue;
					const pos = positions[task.id];
					if (!pos) continue;
					task.layout = { ...(task.layout ?? {}), position: pos };
				}
			});
		});
		return () => {
			cancelled = true;
		};
	}, [doc, changeDoc, spacing, collapsed]);
}

function createTask(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	kind: Task["kind"],
	position: { x: number; y: number },
	parentId: TaskId | null,
	onCreated?: (id: TaskId) => void,
) {
	const id = newId("task");
	changeDoc((d) => {
		const base: Task = {
			id,
			kind,
			title:
				kind === "milestone"
					? "New milestone"
					: kind === "container"
						? "New container"
						: "New task",
			parentId,
			layout: { position: { x: position.x, y: position.y } },
		};
		if (kind === "task") {
			base.estimate = {
				optimistic: 1,
				mostLikely: 2,
				pessimistic: 4,
				unit: "day",
			};
		}
		d.tasksById[id] = base;
		if (kind === "container") ensureContainerInterfaces(d, id);
	});
	onCreated?.(id);
}

function removeTaskFromDoc(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	taskId: TaskId,
) {
	changeDoc((d) => {
		const wasContainer = d.tasksById[taskId]?.kind === "container";
		delete d.tasksById[taskId];
		for (const [depId, dep] of Object.entries(d.dependenciesById)) {
			if (dep.from.taskId === taskId || dep.to.taskId === taskId) {
				delete d.dependenciesById[depId];
			}
		}
		// Orphan any direct children — promote to top-level. (We never delete a
		// container's children silently — destructive cascades belong on a
		// confirmation flow we don't have yet.)
		for (const t of Object.values(d.tasksById)) {
			if (t.parentId === taskId) t.parentId = null;
		}
		if (wasContainer) removeContainerInterfaces(d, taskId);
	});
}

function newId(prefix: string): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `${prefix}_${s}`;
}

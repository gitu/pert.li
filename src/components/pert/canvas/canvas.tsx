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
import { findNeighborTaskId } from "#/lib/pert/canvas-keynav";
import {
	EDGE_STYLE_TO_REACT_FLOW_TYPE,
	type EdgeStyle,
	type LayoutSpacing,
	setContinuousLayout,
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
import { computeSchedule, type Schedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import type { PertDoc, Task, TaskId } from "#/lib/pert/types";
import { useMonteCarlo } from "#/lib/pert/use-monte-carlo";
import { useResolvedTheme } from "#/lib/theme";
import { useIsMobile } from "#/lib/use-media-query";
import {
	COLLAPSED_CARD_WIDTH,
	ContainerCollapsedNode,
	ContainerExpandedNode,
	type ContainerNodeData,
	type ContainerPort,
	containerCollapsedHeight,
} from "./container-node";
import { CycleBanner } from "./cycle-banner";
import { TaskNode, type TaskNodeData } from "./task-node";
import { CanvasAddToolbar, CanvasViewToolbar } from "./toolbar";

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
const CONTAINER_PADDING_X = 36;
const CONTAINER_PADDING_TOP = 44; // header height
const CONTAINER_PADDING_BOTTOM = 36;
const CONTAINER_MIN_WIDTH = 440;
const CONTAINER_MIN_HEIGHT = 280;

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
	const handleToggleContinuous = useCallback(() => {
		setContinuousLayout(projectId, !prefs.continuousLayout);
	}, [projectId, prefs.continuousLayout]);
	useContinuousLayout(
		projectId,
		doc,
		changeDoc,
		prefs.spacing,
		collapsedSet,
		prefs.continuousLayout,
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

	const onContainerResize = useCallback(
		(taskId: TaskId, size: { width: number; height: number }) => {
			changeDoc((d) => {
				const t = d.tasksById[taskId];
				if (!t) return;
				t.layout = {
					...(t.layout ?? {}),
					width: Math.round(size.width),
					height: Math.round(size.height),
				};
			});
		},
		[changeDoc],
	);

	const onDeleteTask = useCallback(
		(taskId: TaskId) => {
			removeTaskFromDoc(changeDoc, taskId);
			selectTask(projectId, null);
		},
		[changeDoc, projectId],
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

	// Edge selection is canvas-local — the inspector doesn't surface edges, so
	// there's no reason to lift it into the cross-component selectionStore.
	// Tracking it here lets the toolbar's Delete button target the selected
	// edge (mirroring what the Backspace/Delete key already does via
	// `onEdgesChange` + `deleteKeyCode`).
	const [, setSelectedEdgeId] = useState<string | null>(null);
	// Container that the user is currently hovering a dragged leaf over. Set
	// while a drag is in progress; nulled when the drag ends or the leaf
	// leaves all container bounds. Drives the drop-target ring on the
	// container node.
	const [dragHoverContainerId, setDragHoverContainerId] =
		useState<TaskId | null>(null);
	// Node id currently in inline-edit mode (double-clicked). The node
	// renders a small title + estimate form in place of its label until the
	// user commits (Enter / blur) or cancels (Esc).
	const [editingNodeId, setEditingNodeId] = useState<TaskId | null>(null);
	const onCancelInlineEdit = useCallback(() => setEditingNodeId(null), []);
	const onCommitInlineEdit = useCallback(
		(taskId: TaskId, next: { title: string; mostLikelyDays?: number }) => {
			changeDoc((d) => {
				const t = d.tasksById[taskId];
				if (!t) return;
				t.title = next.title;
				if (
					typeof next.mostLikelyDays === "number" &&
					t.kind !== "milestone" &&
					t.kind !== "container"
				) {
					const m = next.mostLikelyDays;
					t.estimate = {
						optimistic: Math.max(0.25, m / 2),
						mostLikely: m,
						pessimistic: m * 2,
						unit: t.estimate?.unit ?? "day",
					};
				}
			});
			setEditingNodeId(null);
		},
		[changeDoc],
	);

	// Radial quick-add: spawn a new task or milestone linked by a dependency
	// to the source task. The new node lands one column to the side at the
	// source's y so the auto-layout (when enabled) only needs to nudge, and
	// the user sees it without panning. Inherits the source's container
	// parent so quick-adds inside a container stay inside it. Selecting +
	// entering inline-edit on the new task lets the user immediately rename
	// it without a second click. Milestones skip the estimate block — they
	// have none in the model.
	const onAddLinkedTask = useCallback(
		(
			sourceId: TaskId,
			direction: "successor" | "predecessor",
			kind: "task" | "milestone",
		) => {
			const source = doc.tasksById[sourceId];
			if (!source) return;
			const sourcePos = source.layout?.position ?? { x: 0, y: 0 };
			const offsetX = TASK_WIDTH + 80;
			const position = {
				x:
					direction === "successor"
						? sourcePos.x + offsetX
						: sourcePos.x - offsetX,
				y: sourcePos.y,
			};
			const newTaskId = newId("task");
			const newDepId = newId("dep");
			changeDoc((d) => {
				const draftSource = d.tasksById[sourceId];
				if (!draftSource) return;
				const draft: Task = {
					id: newTaskId,
					kind,
					title: kind === "milestone" ? "New milestone" : "New task",
					parentId: draftSource.parentId ?? null,
					layout: { position },
				};
				if (kind === "task") {
					draft.estimate = {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					};
				}
				d.tasksById[newTaskId] = draft;
				const fromId = direction === "successor" ? sourceId : newTaskId;
				const toId = direction === "successor" ? newTaskId : sourceId;
				d.dependenciesById[newDepId] = {
					id: newDepId,
					from: { taskId: fromId },
					to: { taskId: toId },
					type: "finish_to_start",
				};
			});
			selectTask(projectId, newTaskId);
			setEditingNodeId(newTaskId);
		},
		[changeDoc, doc.tasksById, projectId],
	);
	const reactFlow = useReactFlow();
	const { screenToFlowPosition, setCenter, getZoom } = reactFlow;
	const recentlyCreated = useRecentlyCreatedHighlight(doc, setCenter, getZoom);

	const derivedNodes = useMemo(
		() =>
			buildNodes(
				doc,
				projection,
				scheduleResult,
				onContainerToggle,
				onContainerResize,
				onDeleteTask,
				cycleTaskIds,
				mc.result,
				dragHoverContainerId,
				recentlyCreated,
				editingNodeId,
				onCommitInlineEdit,
				onCancelInlineEdit,
				onAddLinkedTask,
			),
		[
			doc,
			projection,
			scheduleResult,
			onContainerToggle,
			onContainerResize,
			onDeleteTask,
			cycleTaskIds,
			mc.result,
			dragHoverContainerId,
			recentlyCreated,
			editingNodeId,
			onCommitInlineEdit,
			onCancelInlineEdit,
			onAddLinkedTask,
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
					// Live drop-target preview: while a leaf is dragging, check
					// which container its centre is over and mirror that into
					// state so the container node can render a ring. Skip while
					// dragging a container itself (you can't drop a container
					// onto another in the current model).
					if (!isContainer) {
						const center = {
							x: change.position.x + TASK_WIDTH / 2,
							y: change.position.y + TASK_HEIGHT / 2,
						};
						// Exclude the dragged leaf from each container's bounding
						// box so the container snaps back as the leaf is pulled
						// outside its siblings — enabling drag-out.
						const exclude = new Set<TaskId>([change.id]);
						const hover = findContainerAtPoint(
							doc,
							center,
							collapsedSet,
							exclude,
						);
						const valid =
							hover !== null && canReparent(doc, change.id, hover)
								? hover
								: null;
						setDragHoverContainerId((prev) => (prev === valid ? prev : valid));
					}
					continue;
				}

				if (change.dragging !== false) continue;
				setDragHoverContainerId(null);

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
					new Set<TaskId>([change.id]),
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
				const fromTask = d.tasksById[fromId];
				const toTask = d.tasksById[toId];
				if (!fromTask || !toTask) return;
				// Containers can't be edge endpoints — collapsed-edge routing is
				// derived from leaf-to-leaf edges by the projection.
				if (fromTask.kind === "container" || toTask.kind === "container") {
					return;
				}
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

	const onPaneClick = useCallback(() => {
		selectTask(projectId, null);
		setSelectedEdgeId(null);
	}, [projectId]);

	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	// Mirror the global selection into React Flow's local `selected` flag.
	// onNodesChange only mirrors RF → store, so programmatic selections
	// (arrow-key nav, Tab spawn, fresh add) update the store but leave the
	// on-canvas ring stuck on the previously clicked node. Sync the other
	// direction here so the marker follows the inspector.
	useEffect(() => {
		setNodes((current) => {
			let changed = false;
			const next = current.map((n) => {
				const shouldBeSelected = n.id === selectedTaskId;
				if (!!n.selected === shouldBeSelected) return n;
				changed = true;
				return { ...n, selected: shouldBeSelected };
			});
			return changed ? next : current;
		});
	}, [selectedTaskId]);

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

	useEffect(() => {
		return () => {
			selectTask(projectId, null);
		};
	}, [projectId]);

	// Spawn a sibling that shares every predecessor of the seed — the "fan
	// out from this point" gesture used by Shift+Tab. Placed one card-height
	// below the seed at the same x so consecutive Shift+Tabs stack a list of
	// parallel work items. Selecting + entering inline-edit on the new task
	// mirrors `onAddLinkedTask` so the user can immediately rename.
	const onAddSiblingTask = useCallback(
		(seedId: TaskId) => {
			const seed = doc.tasksById[seedId];
			if (!seed) return;
			const seedPos = seed.layout?.position ?? { x: 0, y: 0 };
			const predecessorIds: TaskId[] = [];
			for (const dep of Object.values(doc.dependenciesById)) {
				const from = dep.from.taskId;
				if (dep.to.taskId === seedId && from) predecessorIds.push(from);
			}
			const position = { x: seedPos.x, y: seedPos.y + TASK_HEIGHT + 40 };
			const newTaskId = newId("task");
			changeDoc((d) => {
				const draftSeed = d.tasksById[seedId];
				if (!draftSeed) return;
				const draft: Task = {
					id: newTaskId,
					kind: "task",
					title: "New task",
					parentId: draftSeed.parentId ?? null,
					layout: { position },
					estimate: {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					},
				};
				d.tasksById[newTaskId] = draft;
				for (const predId of predecessorIds) {
					if (!d.tasksById[predId]) continue;
					const depId = newId("dep");
					d.dependenciesById[depId] = {
						id: depId,
						from: { taskId: predId },
						to: { taskId: newTaskId },
						type: "finish_to_start",
					};
				}
			});
			selectTask(projectId, newTaskId);
			setEditingNodeId(newTaskId);
		},
		[changeDoc, doc.dependenciesById, doc.tasksById, projectId],
	);

	// Spawn a fresh task/milestone/container at the viewport centre. If a
	// container is currently selected, the new leaf is dropped inside it —
	// matches the same logic as the toolbar's add buttons so the keyboard
	// and the mouse stay consistent.
	const onAddFreshNode = useCallback(
		(kind: Task["kind"]) => {
			const center = screenToFlowPosition({
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
			});
			const selectedId = selectionStore.state.taskId;
			const selected =
				selectionStore.state.projectId === projectId && selectedId
					? doc.tasksById[selectedId]
					: undefined;
			const parentId =
				selected?.kind === "container" && kind !== "container"
					? selected.id
					: null;
			const newTaskId = newId("task");
			changeDoc((d) => {
				const draft: Task = {
					id: newTaskId,
					kind,
					title:
						kind === "milestone"
							? "New milestone"
							: kind === "container"
								? "New container"
								: "New task",
					parentId,
					layout: { position: center },
				};
				if (kind === "task") {
					draft.estimate = {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					};
				}
				d.tasksById[newTaskId] = draft;
				if (kind === "container") ensureContainerInterfaces(d, newTaskId);
			});
			selectTask(projectId, newTaskId);
			if (kind !== "container") setEditingNodeId(newTaskId);
		},
		[changeDoc, doc.tasksById, projectId, screenToFlowPosition],
	);

	// Keyboard shortcuts on the canvas. Three classes of action, all wired
	// through one capture-phase listener so React Flow's built-in handlers
	// (arrow-nudge, Tab-focus-cycle) never see the event:
	//   • Navigation — arrows walk the dependency graph; ⌘+←/→ creates a
	//     linked predecessor/successor task (also Tab / Shift+Tab below).
	//   • Spawn from selection — Tab adds a downstream task connected to
	//     the seed; Shift+Tab adds a sibling that shares the seed's
	//     predecessors so users can fan out parallel work fast.
	//   • Fresh add — `n` / `m` / `c` add a task / milestone / container
	//     at the viewport centre, with no selection required. Lets users
	//     bootstrap an empty canvas without reaching for the toolbar.
	// Bound via refs so the listener doesn't re-attach on every doc edit.
	const keyNavRef = useRef({
		doc,
		projectId,
		onAddLinkedTask,
		onAddSiblingTask,
		onAddFreshNode,
	});
	keyNavRef.current = {
		doc,
		projectId,
		onAddLinkedTask,
		onAddSiblingTask,
		onAddFreshNode,
	};
	useEffect(() => {
		function isTypingTarget(target: EventTarget | null): boolean {
			const el = target as HTMLElement | null;
			if (!el) return false;
			const tag = el.tagName;
			return (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				tag === "SELECT" ||
				el.isContentEditable === true
			);
		}
		function handler(e: KeyboardEvent) {
			if (e.defaultPrevented) return;
			if (isTypingTarget(e.target)) return;
			const key = e.key;
			const current = keyNavRef.current;
			const state = selectionStore.state;

			// Fresh-add letters — only when no Cmd/Ctrl/Alt is held so we
			// don't collide with browser shortcuts (Cmd+N / Cmd+M / Ctrl+N).
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				if (key === "n" || key === "m" || key === "c") {
					e.preventDefault();
					e.stopPropagation();
					current.onAddFreshNode(
						key === "n" ? "task" : key === "m" ? "milestone" : "container",
					);
					return;
				}
			}

			// Tab / Shift+Tab spawn from the current selection.
			if (key === "Tab") {
				if (state.projectId !== current.projectId || !state.taskId) return;
				const task = current.doc.tasksById[state.taskId];
				if (!task || task.kind === "container") return;
				e.preventDefault();
				e.stopPropagation();
				if (e.shiftKey) current.onAddSiblingTask(state.taskId);
				else current.onAddLinkedTask(state.taskId, "successor", "task");
				return;
			}

			// Everything below this point needs an arrow key + a selection.
			if (
				key !== "ArrowLeft" &&
				key !== "ArrowRight" &&
				key !== "ArrowUp" &&
				key !== "ArrowDown"
			) {
				return;
			}
			if (state.projectId !== current.projectId || !state.taskId) return;
			const task = current.doc.tasksById[state.taskId];
			if (!task || task.kind === "container") return;

			const wantsCreate = e.metaKey || e.ctrlKey;
			if (wantsCreate) {
				if (key !== "ArrowLeft" && key !== "ArrowRight") return;
				e.preventDefault();
				e.stopPropagation();
				current.onAddLinkedTask(
					state.taskId,
					key === "ArrowRight" ? "successor" : "predecessor",
					"task",
				);
				return;
			}

			// Own the arrow key as soon as a task is selected — even when no
			// neighbor exists in that direction, the user's intent is
			// "navigate", not "move the node by 5px". Without this, React
			// Flow's node-move handler picks up the unhandled arrow and the
			// selected task drifts off-grid.
			e.preventDefault();
			e.stopPropagation();
			const dir =
				key === "ArrowLeft"
					? "left"
					: key === "ArrowRight"
						? "right"
						: key === "ArrowUp"
							? "up"
							: "down";
			const next = findNeighborTaskId(current.doc, state.taskId, dir);
			if (next) selectTask(current.projectId, next);
		}
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

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
				onNodeDoubleClick={(_event, node) => {
					// Containers handle expand/collapse via the chevron button —
					// don't grab their double-click. Only leaf nodes get inline
					// edit. Same for the cycle-marked nodes (chrome differs).
					if (node.type === "task") setEditingNodeId(node.id);
				}}
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
					<CanvasAddToolbar
						onAddTask={() => handleAddTask("task")}
						onAddMilestone={() => handleAddTask("milestone")}
						onAddContainer={() => handleAddTask("container")}
					/>
				</div>
			</div>
			{!isMobile && (
				// Sit just above the React Flow Controls (bottom-left), so the
				// re-layout / auto-layout / display controls live next to the
				// pan/zoom navigation utilities. Hidden on mobile to match the
				// Controls panel which is also hidden on touch.
				<div className="pointer-events-none absolute bottom-28 left-3 z-10">
					<div className="pointer-events-auto">
						<CanvasViewToolbar
							prefs={prefs}
							onSetEdgeStyle={handleSetEdgeStyle}
							onSetSpacing={handleSetSpacing}
							onRelayout={handleRelayout}
							onToggleContinuous={handleToggleContinuous}
						/>
					</div>
				</div>
			)}
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
	onResizeContainer: (
		taskId: TaskId,
		size: { width: number; height: number },
	) => void,
	onDeleteTask: (taskId: TaskId) => void,
	cycleTaskIds: ReadonlySet<TaskId>,
	mcResult: MonteCarloResult | null,
	dragHoverContainerId: TaskId | null,
	recentlyCreated: ReadonlySet<TaskId>,
	editingNodeId: TaskId | null,
	onCommitInlineEdit: (
		taskId: TaskId,
		next: { title: string; mostLikelyDays?: number },
	) => void,
	onCancelInlineEdit: () => void,
	onAddLinkedTask: (
		sourceId: TaskId,
		direction: "successor" | "predecessor",
		kind: "task" | "milestone",
	) => void,
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
			// Stored manual size acts as a minimum — descendants can still
			// grow the box, but the user can claim extra room.
			const storedWidth = projected.task.layout?.width ?? 0;
			const storedHeight = projected.task.layout?.height ?? 0;
			const finalWidth = Math.max(bounds.width, storedWidth);
			const finalHeight = Math.max(bounds.height, storedHeight);
			const containerId = projected.task.id;
			const data: ContainerNodeData = {
				title: projected.task.title,
				rollup: null,
				collapsed: false,
				onToggle: () => onToggleContainer(containerId),
				entries: [],
				exits: [],
				dropTarget: dragHoverContainerId === containerId,
				justCreated: recentlyCreated.has(containerId),
				onResizeEnd: (size) => onResizeContainer(containerId, size),
				minWidth: bounds.width,
				minHeight: bounds.height,
				onDelete: () => onDeleteTask(containerId),
			};
			nodes.push({
				id: projected.task.id,
				type: "containerExpanded",
				position: { x: bounds.x, y: bounds.y },
				data: data as unknown as Record<string, unknown>,
				width: finalWidth,
				height: finalHeight,
				// Sit BELOW descendant leaves so children remain fully selectable
				// (the previous "container above with pointer-events: none body"
				// trick was fragile for nested cases). The header strip is
				// outside the leaf area, so it's still clickable for collapse +
				// drag. Selection on the container itself works via React Flow's
				// hit-testing of the bordered frame around the children.
				zIndex: 1,
				draggable: true,
				selectable: true,
				focusable: true,
			});
		} else if (projected.kind === "container-collapsed") {
			const pos = projected.task.layout?.position ??
				fallback[projected.task.id] ?? { x: 0, y: 0 };
			const ports = portsFor(doc, projected.task.id);
			const containerId = projected.task.id;
			const baseData: ContainerNodeData = {
				title: projected.task.title,
				rollup: projected.rollup,
				collapsed: true,
				onToggle: () => onToggleContainer(containerId),
				entries: ports.entries,
				exits: ports.exits,
				dropTarget: dragHoverContainerId === containerId,
				justCreated: recentlyCreated.has(containerId),
				onResizeEnd: (size) => onResizeContainer(containerId, size),
				minWidth: COLLAPSED_CARD_WIDTH,
				onDelete: () => onDeleteTask(containerId),
			};
			const autoHeight = containerCollapsedHeight(baseData);
			const data: ContainerNodeData = { ...baseData, minHeight: autoHeight };
			const storedWidth = projected.task.layout?.width ?? 0;
			const storedHeight = projected.task.layout?.height ?? 0;
			nodes.push({
				id: containerId,
				type: "containerCollapsed",
				position: pos,
				data: data as unknown as Record<string, unknown>,
				width: Math.max(COLLAPSED_CARD_WIDTH, storedWidth),
				height: Math.max(autoHeight, storedHeight),
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
				recentlyCreated,
				onDeleteTask,
				editingNodeId,
				onCommitInlineEdit,
				onCancelInlineEdit,
				onAddLinkedTask,
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
	schedule: Schedule | null,
	cycleTaskIds: ReadonlySet<TaskId>,
	mcResult: MonteCarloResult | null,
	recentlyCreated: ReadonlySet<TaskId>,
	onDeleteTask: (taskId: TaskId) => void,
	editingNodeId: TaskId | null,
	onCommitInlineEdit: (
		taskId: TaskId,
		next: { title: string; mostLikelyDays?: number },
	) => void,
	onCancelInlineEdit: () => void,
	onAddLinkedTask: (
		sourceId: TaskId,
		direction: "successor" | "predecessor",
		kind: "task" | "milestone",
	) => void,
) {
	const task = projected.task;
	const pos = task.layout?.position ?? fallback[task.id] ?? { x: 0, y: 0 };
	const sched = schedule?.tasks[task.id];
	const mcTask = mcResult?.tasks[task.id];
	const editing = editingNodeId === task.id;
	const data: TaskNodeData = {
		title: task.title,
		kind: task.kind === "milestone" ? "milestone" : "task",
		durationDays: sched?.duration ?? 0,
		mostLikelyDays: task.estimate?.mostLikely,
		slackDays: sched?.slack ?? null,
		critical: sched?.critical ?? false,
		hasEstimate: Boolean(task.estimate),
		cycle: cycleTaskIds.has(task.id),
		status: sched?.status ?? task.status ?? "not_started",
		progress: sched?.progress ?? task.progress ?? 0,
		criticality: mcTask?.criticality,
		justCreated: recentlyCreated.has(task.id),
		onDelete: () => onDeleteTask(task.id),
		editing,
		onCommitEdit: editing
			? (next) => onCommitInlineEdit(task.id, next)
			: undefined,
		onCancelEdit: editing ? onCancelInlineEdit : undefined,
		onAddPredecessor: (kind) => onAddLinkedTask(task.id, "predecessor", kind),
		onAddSuccessor: (kind) => onAddLinkedTask(task.id, "successor", kind),
	};
	nodes.push({
		id: task.id,
		type: "task",
		position: pos,
		data: data as unknown as Record<string, unknown>,
		width: TASK_WIDTH,
		height: TASK_HEIGHT,
		// Leaves sit above container backgrounds so they remain interactive.
		zIndex: 10,
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
			sourceHandle: edge.sourceInterfaceId,
			targetHandle: edge.targetInterfaceId,
			type: reactFlowType,
			animated: edge.critical || onCycle,
			style,
			data: { onCycle },
			// Sit above expanded containers (zIndex 1) but below leaf task
			// nodes (zIndex 10) so an edge passing through a container's
			// area is never visually hidden by the container body, while
			// leaves still paint on top of the edge stroke.
			zIndex: 5,
		};
	});
}

// Project doc → ports for the collapsed container node, sorted by id so the
// rendered order is stable across re-renders.
function portsFor(
	doc: PertDoc,
	containerId: TaskId,
): { entries: ContainerPort[]; exits: ContainerPort[] } {
	const bucket = doc.interfacesByContainerId[containerId] ?? {};
	const entries: ContainerPort[] = [];
	const exits: ContainerPort[] = [];
	for (const iface of Object.values(bucket)) {
		const port: ContainerPort = { id: iface.id, label: iface.label };
		if (iface.kind === "entry") entries.push(port);
		else exits.push(port);
	}
	entries.sort((a, b) => a.id.localeCompare(b.id));
	exits.sort((a, b) => a.id.localeCompare(b.id));
	return { entries, exits };
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

// Detects tasks that have just appeared in the doc since the previous render
// and pans the camera onto them while also tagging them so the node renderer
// can flash a brief highlight ring. First-mount tasks are NOT counted as
// "new" — only additions made while the canvas is mounted.
function useRecentlyCreatedHighlight(
	doc: PertDoc,
	setCenter: (
		x: number,
		y: number,
		options?: { zoom?: number; duration?: number },
	) => void,
	getZoom: () => number,
): Set<TaskId> {
	const lastSeen = useRef<Set<TaskId> | null>(null);
	const [recent, setRecent] = useState<Set<TaskId>>(() => new Set());
	useEffect(() => {
		const current = new Set(Object.keys(doc.tasksById));
		if (lastSeen.current === null) {
			lastSeen.current = current;
			return;
		}
		const additions: TaskId[] = [];
		for (const id of current) {
			if (!lastSeen.current.has(id)) additions.push(id);
		}
		lastSeen.current = current;
		if (additions.length === 0) return;
		setRecent((prev) => {
			const next = new Set(prev);
			for (const id of additions) next.add(id);
			return next;
		});
		// Pan to the first new task. For multi-task batches (e.g. AI tool
		// loops), pan to the first; the rest pulse in place. The position may
		// still be undefined on the doc — fall back to the next animation
		// frame so ELK/auto-layout has a chance to assign positions first.
		const targetId = additions[0];
		const tryPan = (attempt: number) => {
			const t = doc.tasksById[targetId];
			const pos = t?.layout?.position;
			if (pos) {
				const cx = pos.x + TASK_WIDTH / 2;
				const cy = pos.y + TASK_HEIGHT / 2;
				setCenter(cx, cy, { zoom: getZoom(), duration: 350 });
				return;
			}
			if (attempt > 30) return;
			window.requestAnimationFrame(() => tryPan(attempt + 1));
		};
		window.requestAnimationFrame(() => tryPan(0));
		// Clear the highlight after the pulse animation has played a couple
		// of times. Keep this in sync with the CSS animation duration.
		const timers = additions.map((id) =>
			window.setTimeout(() => {
				setRecent((prev) => {
					if (!prev.has(id)) return prev;
					const out = new Set(prev);
					out.delete(id);
					return out;
				});
			}, 2400),
		);
		return () => {
			for (const t of timers) window.clearTimeout(t);
		};
	}, [doc, setCenter, getZoom]);
	return recent;
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

// Continuous auto-layout. When enabled, every structural doc change (new
// node / edge, reparent, collapse toggle, kind switch) re-runs ELK and
// commits the resulting positions. To keep the user oriented, we capture
// the *screen* position of the currently selected node before laying out,
// then pan the viewport so the same node lands at the same screen pixel
// after the new positions render. Without this, large reflows yank focus
// to wherever ELK happened to place the selection — disorienting and a
// real reason users avoid auto-layout.
//
// Layout only kicks off on a structural fingerprint change. Pure position
// edits (a manual drag) deliberately don't trigger a reflow, so the user's
// own drag isn't immediately undone.
function useContinuousLayout(
	projectId: string,
	doc: PertDoc,
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	spacing: LayoutSpacing,
	collapsed: ReadonlySet<TaskId>,
	enabled: boolean,
) {
	const reactFlow = useReactFlow();
	const structuralKey = useMemo(() => {
		const tasks = Object.values(doc.tasksById)
			.map(
				(t) =>
					`${t.id}|${t.parentId ?? ""}|${t.kind}|${
						collapsed.has(t.id) ? "c" : "e"
					}`,
			)
			.sort()
			.join(",");
		const deps = Object.values(doc.dependenciesById)
			.map((d) => `${d.from.taskId ?? "*"}->${d.to.taskId ?? "*"}`)
			.sort()
			.join(",");
		return `${tasks}::${deps}::${spacing}`;
	}, [doc, collapsed, spacing]);

	// structuralKey stands in for doc/changeDoc/spacing/collapsed/reactFlow —
	// re-running on those would loop (changeDoc) or thrash (every doc edit).
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		// Debounce so a flurry of edits (e.g. typing in the inline form)
		// doesn't run ELK on every keystroke.
		const handle = window.setTimeout(async () => {
			const selectedTaskId = selectionStore.state.taskId;
			const isSelectedInProject =
				selectionStore.state.projectId === projectId && selectedTaskId;
			// Capture the selected node's screen position BEFORE the layout
			// runs — this is the pixel we want it to stay at.
			let pin: { id: TaskId; screen: { x: number; y: number } } | null = null;
			if (isSelectedInProject) {
				const rfNode = reactFlow.getNode(selectedTaskId);
				if (rfNode) {
					pin = {
						id: selectedTaskId,
						screen: reactFlow.flowToScreenPosition({
							x: rfNode.position.x,
							y: rfNode.position.y,
						}),
					};
				}
			}
			const positions = await computeLayout(doc, {
				spacing,
				forceReflow: true,
				collapsed,
			});
			if (cancelled) return;
			// Apply positions. Expanded containers derive their position from
			// children, so only leaves + collapsed containers need updating.
			changeDoc((d) => {
				for (const task of Object.values(d.tasksById)) {
					if (task.kind === "container" && !collapsed.has(task.id)) continue;
					const pos = positions[task.id];
					if (!pos) continue;
					task.layout = { ...(task.layout ?? {}), position: pos };
				}
			});
			// After the new positions land, pan the viewport so the pinned
			// node's screen position is unchanged. requestAnimationFrame
			// gives React Flow one frame to apply the new positions before
			// we compute the offset.
			if (pin) {
				const after = positions[pin.id];
				if (after) {
					requestAnimationFrame(() => {
						const vp = reactFlow.getViewport();
						reactFlow.setViewport({
							x: pin.screen.x - after.x * vp.zoom,
							y: pin.screen.y - after.y * vp.zoom,
							zoom: vp.zoom,
						});
					});
				}
			}
		}, 350);
		return () => {
			cancelled = true;
			window.clearTimeout(handle);
		};
	}, [structuralKey, enabled, projectId]);
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

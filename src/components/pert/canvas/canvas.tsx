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
	setGroupingMaxLevel,
	setLayoutSpacing,
	useCanvasPrefs,
} from "#/lib/pert/canvas-prefs";
import {
	setCollapsed,
	toggleCollapse,
	useCollapsedSet,
} from "#/lib/pert/collapse";
import { cycleEdgeSet, cycleTaskSet } from "#/lib/pert/cycle";
import {
	type CanvasFieldId,
	type ResolvedSurface,
	resolveDisplaySettings,
} from "#/lib/pert/display";
import { explainExpectedDuration, explainSlack } from "#/lib/pert/explain";
import {
	assignTaskToGroupMutation,
	deleteGroupMutation,
} from "#/lib/pert/group-mutations";
import { getGroupAncestors, isGroupRendered } from "#/lib/pert/hierarchy";
import { computeLayout, fallbackGridLayout } from "#/lib/pert/layout";
import type { MonteCarloResult } from "#/lib/pert/montecarlo";
import { computeNumbering } from "#/lib/pert/numbering";
import { type ProjectedNode, projectGraph } from "#/lib/pert/projection";
import {
	buildGroupSnapshot,
	findGroupAtPointInSnapshot,
	groupBoundsFromMembers,
	shiftGroupMembersMutation,
} from "#/lib/pert/reparent";
import {
	type ResolvedStaffing,
	resolveScheduling,
} from "#/lib/pert/resolve-scheduling";
import {
	computeSchedule,
	type Schedule,
	teamCapacityPerDay,
} from "#/lib/pert/schedule";
import { peopleForDuration } from "#/lib/pert/staffing";
import {
	consumeLocallyCreated,
	selectGroup,
	selectionStore,
	selectTask,
} from "#/lib/pert/store";
import type {
	CanvasLayoutMode,
	GroupId,
	PertDoc,
	Task,
	TaskId,
} from "#/lib/pert/types";
import { useMonteCarlo } from "#/lib/pert/use-monte-carlo";
import { useResolvedTheme } from "#/lib/theme";
import { useIsMobile } from "#/lib/use-media-query";
import { CycleBanner } from "./cycle-banner";
import {
	COLLAPSED_CARD_WIDTH,
	GroupCollapsedNode,
	GroupExpandedNode,
	type GroupNodeData,
	groupCollapsedHeight,
} from "./group-node";
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
	groupCollapsed: GroupCollapsedNode,
	groupExpanded: GroupExpandedNode,
};

const TASK_WIDTH = 200;
const TASK_HEIGHT = 80;

// Z-ordering. Group boxes stack by NESTING DEPTH — an outer group sits lowest,
// each nested group one layer above it — so inner frames and headers stay
// visible and clickable inside their parents. Edges paint above every
// group body (an edge crossing a group is never hidden), and leaf /
// milestone nodes paint above everything.
const GROUP_BASE_Z = 1; // + nesting depth
const EDGE_Z = 50; // safely above any realistic group nesting depth
const LEAF_Z = 100;

function CanvasInner({ projectId, doc, changeDoc }: CanvasProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const prefs = useCanvasPrefs(projectId);
	const maxLevel = prefs.groupingMaxLevel;
	const collapsedSet = useCollapsedSet(projectId);
	useAutoLayout(doc, changeDoc, prefs.spacing, collapsedSet, maxLevel);

	const handleRelayout = useCallback(async () => {
		const positions = await computeLayout(doc, {
			spacing: prefs.spacing,
			forceReflow: true,
			collapsed: collapsedSet,
			maxLevel,
		});
		changeDoc((d) => {
			for (const task of Object.values(d.tasksById)) {
				const pos = positions[task.id];
				if (!pos) continue;
				task.layout = { ...(task.layout ?? {}), position: pos };
			}
			// Group positions anchor collapsed / empty groups; expanded groups
			// derive their box from member bounds, so writing a position is
			// harmless for them.
			for (const group of Object.values(d.groupsById)) {
				const pos = positions[group.id];
				if (!pos) continue;
				group.layout = { ...(group.layout ?? {}), position: pos };
			}
		});
	}, [doc, changeDoc, prefs.spacing, collapsedSet, maxLevel]);

	const handleSetEdgeStyle = useCallback(
		(style: EdgeStyle) => setEdgeStyle(projectId, style),
		[projectId],
	);
	const handleSetSpacing = useCallback(
		(spacing: LayoutSpacing) => setLayoutSpacing(projectId, spacing),
		[projectId],
	);
	const handleSetGroupingLevel = useCallback(
		(level: number) => setGroupingMaxLevel(projectId, level),
		[projectId],
	);
	const handleToggleContinuous = useCallback(() => {
		setContinuousLayout(projectId, !prefs.continuousLayout);
	}, [projectId, prefs.continuousLayout]);

	// Collapse / expand every group at once (toolbar buttons). The buttons
	// only render when the project actually has groups.
	const hasGroups = useMemo(
		() => Object.keys(doc.groupsById).length > 0,
		[doc],
	);
	const handleCollapseAll = useCallback(() => {
		for (const id of Object.keys(doc.groupsById)) {
			setCollapsed(projectId, id, true);
		}
	}, [doc, projectId]);
	const handleExpandAll = useCallback(() => {
		for (const id of Object.keys(doc.groupsById)) {
			setCollapsed(projectId, id, false);
		}
	}, [doc, projectId]);

	useContinuousLayout(
		projectId,
		doc,
		changeDoc,
		prefs.spacing,
		collapsedSet,
		maxLevel,
		prefs.continuousLayout,
	);

	const projection = useMemo(
		() => projectGraph(doc, scheduleResult, collapsedSet, maxLevel),
		[doc, scheduleResult, collapsedSet, maxLevel],
	);

	const numbering = useMemo(() => computeNumbering(doc), [doc]);

	const cycle = scheduleResult.ok ? null : scheduleResult.cycle;
	const cycleTaskIds = useMemo(
		() => (cycle ? cycleTaskSet(cycle) : new Set<TaskId>()),
		[cycle],
	);
	const cycleEdgeIds = useMemo(
		() => (cycle ? cycleEdgeSet(doc, cycle) : new Set<string>()),
		[doc, cycle],
	);

	const onGroupResize = useCallback(
		(groupId: GroupId, size: { width: number; height: number }) => {
			changeDoc((d) => {
				const g = d.groupsById[groupId];
				if (!g) return;
				g.layout = {
					...(g.layout ?? {}),
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

	const onDeleteGroup = useCallback(
		(groupId: GroupId) => {
			changeDoc((d) => {
				deleteGroupMutation(d, { groupId });
			});
			selectGroup(projectId, null);
		},
		[changeDoc, projectId],
	);

	const onGroupToggle = useCallback(
		(groupId: GroupId) => {
			// Capture the expanded box position into the group before collapsing
			// so the collapsed card lands at the same spot users last saw it. We
			// store only the position — not the (large) expanded width/height —
			// so the collapsed card keeps its compact size.
			if (!collapsedSet.has(groupId)) {
				const bounds = groupBoundsFromMembers(doc, groupId, {
					collapsed: collapsedSet,
					maxLevel,
				});
				if (bounds) {
					changeDoc((d) => {
						const g = d.groupsById[groupId];
						if (!g) return;
						g.layout = {
							...(g.layout ?? {}),
							position: { x: bounds.x, y: bounds.y },
						};
					});
				}
			}
			toggleCollapse(projectId, groupId);
		},
		[changeDoc, collapsedSet, doc, projectId, maxLevel],
	);

	const mc = useMonteCarlo(doc, { trials: 1500 });

	// Edge selection is canvas-local — the inspector doesn't surface edges, so
	// there's no reason to lift it into the cross-component selectionStore.
	// Tracking it here lets the toolbar's Delete button target the selected
	// edge (mirroring what the Backspace/Delete key already does via
	// `onEdgesChange` + `deleteKeyCode`).
	const [, setSelectedEdgeId] = useState<string | null>(null);
	// Group that the user is currently hovering a dragged leaf over. Set
	// while a drag is in progress; nulled when the drag ends or the leaf
	// leaves all group bounds. Drives the drop-target ring on the group node.
	const [dragHoverGroupId, setDragHoverGroupId] = useState<GroupId | null>(
		null,
	);
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
				if (typeof next.mostLikelyDays === "number" && t.kind !== "milestone") {
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
	// the user sees it without panning. Inherits the source's group so
	// quick-adds inside a group stay inside it. Selecting + entering
	// inline-edit on the new task lets the user immediately rename it without
	// a second click. Milestones skip the estimate block — they have none in
	// the model.
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
				const gid = draftSource.groupId ?? null;
				if (gid && d.groupsById[gid]) {
					assignTaskToGroupMutation(d, { taskId: newTaskId, groupId: gid });
				}
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

	// Split the node build so the heavy bounds/ports/layout work only re-runs
	// when structural inputs change. Overlay flags (drag hover, inline edit,
	// MC criticality, just-created flash) layer on cheaply and keep stable
	// references for unaffected nodes — that's what stops React Flow from
	// re-diffing every node on every drag frame or MC result.
	// DISPLAY-SETTINGS: resolved per-project canvas display config (which node
	// fields + density). Derived from `doc`, so it rides the baseNodes memo and
	// only changes identity when the doc does.
	const displayCanvas = useMemo(
		() => resolveDisplaySettings(doc).canvas,
		[doc],
	);
	const baseNodes = useMemo(
		() =>
			buildBaseNodes(
				doc,
				projection,
				scheduleResult,
				numbering.groups,
				onGroupToggle,
				onGroupResize,
				onDeleteTask,
				onDeleteGroup,
				cycleTaskIds,
				onAddLinkedTask,
				collapsedSet,
				maxLevel,
				displayCanvas,
			),
		[
			doc,
			projection,
			scheduleResult,
			numbering,
			onGroupToggle,
			onGroupResize,
			onDeleteTask,
			onDeleteGroup,
			cycleTaskIds,
			onAddLinkedTask,
			collapsedSet,
			maxLevel,
			displayCanvas,
		],
	);
	const derivedNodes = useMemo(
		() =>
			applyNodeOverlays(
				baseNodes,
				dragHoverGroupId,
				recentlyCreated,
				editingNodeId,
				mc.result,
				onCommitInlineEdit,
				onCancelInlineEdit,
			),
		[
			baseNodes,
			dragHoverGroupId,
			recentlyCreated,
			editingNodeId,
			mc.result,
			onCommitInlineEdit,
			onCancelInlineEdit,
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
	// group-card drags (members need to follow) and skip no-op leaf drops.
	const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(
		new Map(),
	);
	// Group-bounds snapshot taken when a leaf drag begins. While a single
	// leaf is dragging the bounds (computed with that leaf excluded) don't
	// change, so we cache them and skip the O(groups × members) doc walk that
	// `findGroupAtPoint` would do on every drag frame.
	const dragSnapshots = useRef<
		Map<string, ReturnType<typeof buildGroupSnapshot>>
	>(new Map());

	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			setNodes((current) => applyNodeChanges(changes, current));
			for (const change of changes) {
				if (change.type !== "position" || !change.position) {
					if (change.type === "remove") {
						// React Flow's Delete key can target a group card too —
						// deleting a group promotes its members rather than cascading.
						if (doc.groupsById[change.id]) {
							changeDoc((d) => {
								deleteGroupMutation(d, { groupId: change.id });
							});
							selectGroup(projectId, null);
						} else {
							removeTaskFromDoc(changeDoc, change.id);
						}
					} else if (change.type === "select" && change.selected) {
						// Only mirror "selected: true" into our store. React Flow can
						// fire `selected: false` for reasons unrelated to user intent
						// (resize during fullscreen toggle, node-list re-syncs), and
						// silently clearing the selection there hides the fullscreen
						// inspector popup. Explicit deselection lives in onPaneClick.
						if (doc.groupsById[change.id]) selectGroup(projectId, change.id);
						else selectTask(projectId, change.id);
						setSelectedEdgeId(null);
					}
					continue;
				}

				const task = doc.tasksById[change.id];
				const isGroup = Boolean(doc.groupsById[change.id]);

				if (change.dragging === true) {
					if (!dragStartPositions.current.has(change.id)) {
						dragStartPositions.current.set(change.id, {
							x: change.position.x,
							y: change.position.y,
						});
						if (!isGroup) {
							// Cache group bounds once for the lifetime of this drag.
							// Exclude the dragged leaf so the bounds shrink — that's
							// what lets the user drag a leaf back out of its group.
							dragSnapshots.current.set(
								change.id,
								buildGroupSnapshot(
									doc,
									collapsedSet,
									new Set<TaskId>([change.id]),
									maxLevel,
								),
							);
						}
					}
					// Live drop-target preview: while a leaf is dragging, check
					// which group its centre is over and mirror that into state so
					// the group node can render a ring. Skip while dragging a group
					// card itself (groups re-nest via the inspector, not drag).
					if (!isGroup) {
						const center = {
							x: change.position.x + TASK_WIDTH / 2,
							y: change.position.y + TASK_HEIGHT / 2,
						};
						const snapshot = dragSnapshots.current.get(change.id) ?? [];
						const hover = findGroupAtPointInSnapshot(snapshot, center);
						setDragHoverGroupId((prev) => (prev === hover ? prev : hover));
					}
					continue;
				}

				if (change.dragging !== false) continue;
				setDragHoverGroupId(null);

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
				const snapshot = dragSnapshots.current.get(change.id);
				dragSnapshots.current.delete(change.id);

				if (isGroup) {
					// Drag a group card: shift every member by the same delta so the
					// bounds-from-members calc re-anchors the box at the dropped
					// location, and store the group's own position so collapsed /
					// empty groups (which have no members to derive from) follow too.
					if (!start) continue;
					const dx = next.x - start.x;
					const dy = next.y - start.y;
					if (dx === 0 && dy === 0) continue;
					changeDoc((d) => {
						shiftGroupMembersMutation(change.id, dx, dy)(d);
						const g = d.groupsById[change.id];
						if (g) g.layout = { ...(g.layout ?? {}), position: next };
					});
					continue;
				}

				// Leaf task: write position, and possibly re-group if it was
				// dropped inside a group's bounds. Reuse the drag-start snapshot for
				// the drop hit-test — the bounds are still accurate (other members
				// haven't moved) and avoids a fresh doc walk.
				changeDoc((d) => {
					const draft = d.tasksById[change.id];
					if (!draft) return;
					draft.layout = { ...(draft.layout ?? {}), position: next };
				});
				const targetGroup = snapshot
					? findGroupAtPointInSnapshot(snapshot, {
							x: next.x + TASK_WIDTH / 2,
							y: next.y + TASK_HEIGHT / 2,
						})
					: null;
				const currentGroup = task?.groupId ?? null;
				if (targetGroup !== null && targetGroup !== currentGroup) {
					changeDoc((d) => {
						assignTaskToGroupMutation(d, {
							taskId: change.id,
							groupId: targetGroup,
						});
					});
				} else if (targetGroup === null && currentGroup) {
					// Dropped outside any group — ungroup if it was previously a member.
					changeDoc((d) => {
						assignTaskToGroupMutation(d, { taskId: change.id, groupId: null });
					});
				}
			}
		},
		[changeDoc, doc, projectId, collapsedSet, maxLevel],
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
	const selectedGroupId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.groupId : null,
	);

	const handleAddTask = useCallback(
		(kind: Task["kind"]) => {
			const center = screenToFlowPosition({
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
			});
			// If a group is currently selected, drop the new task into it.
			createTask(changeDoc, kind, center, selectedGroupId, (id) =>
				selectTask(projectId, id),
			);
		},
		[changeDoc, projectId, screenToFlowPosition, selectedGroupId],
	);

	useEffect(() => {
		return () => {
			selectTask(projectId, null);
		};
	}, [projectId]);

	// Mirror the selected task id into React Flow's per-node `selected` flag,
	// and pan the camera if the new selection isn't currently in view. React
	// Flow tracks node selection in its own local state — without this, only
	// the mouse-driven selection paints a ring, and keynav / programmatic
	// selection leaves the visual marker on whatever the user last clicked.
	// The visibility check uses real DOM rects so it accounts for the
	// current zoom + viewport; if any part of the node overlaps the React
	// Flow container we leave the camera alone (the user can see it).
	// biome-ignore lint/correctness/useExhaustiveDependencies: doc/reactFlow/setNodes are accessed through a ref so the effect only fires when the selection actually changes — re-running on doc would re-pan on every edit
	useEffect(() => {
		const selectedNodeId = selectedTaskId ?? selectedGroupId;
		setNodes((current) =>
			current.map((n) => {
				const shouldSelect = n.id === selectedNodeId;
				if (n.selected === shouldSelect) return n;
				return { ...n, selected: shouldSelect };
			}),
		);
		// Camera follow only applies to task selection; group boxes derive their
		// position from members and are large enough to find without panning.
		if (!selectedTaskId) return;
		const task = doc.tasksById[selectedTaskId];
		if (!task) return;
		const pos = task.layout?.position;
		if (!pos) return;
		const handle = requestAnimationFrame(() => {
			const nodeEl = document.querySelector(
				`.react-flow__node[data-id="${CSS.escape(selectedTaskId)}"]`,
			) as HTMLElement | null;
			if (!nodeEl) return;
			const flowEl = nodeEl.closest(".react-flow") as HTMLElement | null;
			if (!flowEl) return;
			const nodeRect = nodeEl.getBoundingClientRect();
			const flowRect = flowEl.getBoundingClientRect();
			const overlaps =
				nodeRect.right > flowRect.left &&
				nodeRect.left < flowRect.right &&
				nodeRect.bottom > flowRect.top &&
				nodeRect.top < flowRect.bottom;
			if (overlaps) return;
			const width = nodeRect.width || TASK_WIDTH;
			const height = nodeRect.height || TASK_HEIGHT;
			reactFlow.setCenter(pos.x + width / 2, pos.y + height / 2, {
				zoom: reactFlow.getZoom(),
				duration: 300,
			});
		});
		return () => cancelAnimationFrame(handle);
	}, [selectedTaskId, selectedGroupId]);

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
					layout: { position },
					estimate: {
						optimistic: 1,
						mostLikely: 2,
						pessimistic: 4,
						unit: "day",
					},
				};
				d.tasksById[newTaskId] = draft;
				const gid = draftSeed.groupId ?? null;
				if (gid && d.groupsById[gid]) {
					assignTaskToGroupMutation(d, { taskId: newTaskId, groupId: gid });
				}
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

	// Spawn a fresh task/milestone at the viewport centre. If a group is
	// currently selected, the new leaf is dropped into it — matches the same
	// logic as the toolbar's add buttons so the keyboard and the mouse stay
	// consistent.
	const onAddFreshNode = useCallback(
		(kind: Task["kind"]) => {
			const center = screenToFlowPosition({
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
			});
			const groupId =
				selectionStore.state.projectId === projectId
					? selectionStore.state.groupId
					: null;
			const newTaskId = newId("task");
			changeDoc((d) => {
				const draft: Task = {
					id: newTaskId,
					kind,
					title: kind === "milestone" ? "New milestone" : "New task",
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
				if (groupId && d.groupsById[groupId]) {
					assignTaskToGroupMutation(d, { taskId: newTaskId, groupId });
				}
			});
			selectTask(projectId, newTaskId);
			setEditingNodeId(newTaskId);
		},
		[changeDoc, projectId, screenToFlowPosition],
	);

	// Keyboard shortcuts on the canvas. Three classes of action, all wired
	// through one capture-phase listener so React Flow's built-in handlers
	// (arrow-nudge, Tab-focus-cycle) never see the event:
	//   • Navigation — arrows walk the dependency graph; ⌘+←/→ creates a
	//     linked predecessor/successor task (also Tab / Shift+Tab below).
	//   • Spawn from selection — Tab adds a downstream task connected to
	//     the seed; Shift+Tab adds a sibling that shares the seed's
	//     predecessors so users can fan out parallel work fast.
	//   • Fresh add — `n` / `m` add a task / milestone at the viewport centre,
	//     with no selection required. Lets users bootstrap an empty canvas
	//     without reaching for the toolbar.
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
				if (key === "n" || key === "m") {
					e.preventDefault();
					e.stopPropagation();
					current.onAddFreshNode(key === "n" ? "task" : "milestone");
					return;
				}
			}

			// Tab / Shift+Tab spawn from the current selection.
			if (key === "Tab") {
				if (state.projectId !== current.projectId || !state.taskId) return;
				const task = current.doc.tasksById[state.taskId];
				if (!task) return;
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
			if (!task) return;

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
					// Group boxes handle expand/collapse via the chevron button —
					// don't grab their double-click. Only leaf nodes get inline
					// edit. Same for the cycle-marked nodes (chrome differs).
					if (node.type === "task") setEditingNodeId(node.id);
				}}
				fitView
				// The minimum zoom bounds both pinch/scroll zoom-out AND how far
				// fitView can shrink the graph. Keep it very low so any layout —
				// however large — can always be brought fully into view; fitView
				// only zooms out as far as it actually needs.
				minZoom={isMobile ? 0.05 : 0.02}
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
							onCollapseAll={hasGroups ? handleCollapseAll : undefined}
							onExpandAll={hasGroups ? handleExpandAll : undefined}
							onSetGroupingLevel={
								hasGroups ? handleSetGroupingLevel : undefined
							}
						/>
					</div>
				</div>
			)}
			{cycle && (
				<div className="pointer-events-none absolute left-1/2 top-14 z-[1100] -translate-x-1/2">
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
				<p className="text-xs">
					Once you have a few, drag from a node's side dot to link tasks
					together.
				</p>
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

// The "base" nodes — depend only on structural inputs (doc, projection,
// schedule, cycle set) and stable callbacks. Drag-hover, inline-edit, MC
// criticality, and just-created highlights are layered on by
// `applyNodeOverlays` below so those signals don't force a full rebuild on
// every keystroke / drag frame.
function buildBaseNodes(
	doc: PertDoc,
	projection: ReturnType<typeof projectGraph>,
	scheduleResult: ReturnType<typeof computeSchedule>,
	groupNumbers: Record<GroupId, string>,
	onToggleGroup: (groupId: GroupId) => void,
	onResizeGroup: (
		groupId: GroupId,
		size: { width: number; height: number },
	) => void,
	onDeleteTask: (taskId: TaskId) => void,
	onDeleteGroup: (groupId: GroupId) => void,
	cycleTaskIds: ReadonlySet<TaskId>,
	onAddLinkedTask: (
		sourceId: TaskId,
		direction: "successor" | "predecessor",
		kind: "task" | "milestone",
	) => void,
	collapsed: ReadonlySet<GroupId>,
	maxLevel: number,
	display: ResolvedSurface<CanvasLayoutMode, CanvasFieldId>,
): Node[] {
	const fallback = fallbackGridLayout(doc);
	const schedule = scheduleResult.ok ? scheduleResult.schedule : null;
	// PARALLEL-STAFFING: active staffing config for the per-node badge, or null
	// when disabled or when team mode is on (which wins). Sized off each task's
	// PERT expected so the badge is independent of basis/scaling.
	const resolvedStaffing = resolveScheduling(doc).staffing;
	const staffing: ResolvedStaffing | null =
		teamCapacityPerDay(doc) === 0 && resolvedStaffing.enabled
			? resolvedStaffing
			: null;
	const nodes: Node[] = [];

	for (const projected of projection.nodes) {
		if (projected.kind === "group-expanded") {
			const group = projected.group;
			// Bounds derive from what's drawn inside (members + nested boxes),
			// matching the drop hit-test and folding collapsed/over-deep children.
			// groupBoundsFromMembers only returns null for a missing group.
			const bounds = groupBoundsFromMembers(doc, group.id, {
				collapsed,
				maxLevel,
			});
			if (!bounds) continue;
			// Stored manual size acts as a minimum — members can still grow the
			// box, but the user can claim extra room.
			const storedWidth = group.layout?.width ?? 0;
			const storedHeight = group.layout?.height ?? 0;
			const finalWidth = Math.max(bounds.width, storedWidth);
			const finalHeight = Math.max(bounds.height, storedHeight);
			const data: GroupNodeData = {
				name: group.name,
				number: groupNumbers[group.id] ?? "",
				rollup: null,
				collapsed: false,
				onToggle: () => onToggleGroup(group.id),
				dropTarget: false,
				justCreated: false,
				onResizeEnd: (size) => onResizeGroup(group.id, size),
				minWidth: bounds.width,
				minHeight: bounds.height,
				onDelete: () => onDeleteGroup(group.id),
			};
			nodes.push({
				id: group.id,
				type: "groupExpanded",
				position: { x: bounds.x, y: bounds.y },
				data: data as unknown as Record<string, unknown>,
				width: finalWidth,
				height: finalHeight,
				// Sit BELOW member leaves so they remain fully selectable. The
				// header strip is outside the member area, so it's still clickable
				// for collapse + drag.
				//
				// Depth-based: nested groups paint ABOVE their parent group so an
				// inner frame/header is never hidden behind the outer one.
				zIndex: GROUP_BASE_Z + getGroupAncestors(doc, group.id).length,
				draggable: true,
				selectable: true,
				focusable: true,
			});
		} else if (projected.kind === "group-collapsed") {
			const group = projected.group;
			const pos = group.layout?.position ??
				fallback[group.id] ?? { x: 0, y: 0 };
			const baseData: GroupNodeData = {
				name: group.name,
				number: groupNumbers[group.id] ?? "",
				rollup: projected.rollup,
				collapsed: true,
				onToggle: () => onToggleGroup(group.id),
				dropTarget: false,
				justCreated: false,
				onResizeEnd: (size) => onResizeGroup(group.id, size),
				minWidth: COLLAPSED_CARD_WIDTH,
				onDelete: () => onDeleteGroup(group.id),
			};
			const autoHeight = groupCollapsedHeight(baseData);
			const data: GroupNodeData = { ...baseData, minHeight: autoHeight };
			const storedWidth = group.layout?.width ?? 0;
			const storedHeight = group.layout?.height ?? 0;
			nodes.push({
				id: group.id,
				type: "groupCollapsed",
				position: pos,
				data: data as unknown as Record<string, unknown>,
				width: Math.max(COLLAPSED_CARD_WIDTH, storedWidth),
				height: Math.max(autoHeight, storedHeight),
				// Same depth-based stacking as expanded groups — a collapsed inner
				// group still paints above its parent group's body.
				zIndex: GROUP_BASE_Z + getGroupAncestors(doc, group.id).length,
			});
		} else {
			pushLeafNode(
				nodes,
				projected,
				fallback,
				schedule,
				cycleTaskIds,
				onDeleteTask,
				onAddLinkedTask,
				display,
				staffing,
			);
		}
	}

	return nodes;
}

// Overlay the volatile UI signals (drag hover, inline-edit, MC criticality,
// just-created flash) on top of the base nodes. Returns the same node
// reference for any node not touched by an overlay, so React Flow's diff
// stays cheap when only one or two nodes change.
function applyNodeOverlays(
	baseNodes: Node[],
	dragHoverGroupId: GroupId | null,
	recentlyCreated: ReadonlySet<TaskId>,
	editingNodeId: TaskId | null,
	mcResult: MonteCarloResult | null,
	onCommitInlineEdit: (
		taskId: TaskId,
		next: { title: string; mostLikelyDays?: number },
	) => void,
	onCancelInlineEdit: () => void,
): Node[] {
	return baseNodes.map((n) => {
		if (n.type === "task") {
			const taskId = n.id as TaskId;
			const baseData = n.data as unknown as TaskNodeData;
			const mcTask = mcResult?.tasks[taskId];
			const criticality = mcTask?.criticality;
			const editing = editingNodeId === taskId;
			const just = recentlyCreated.has(taskId);
			if (
				baseData.criticality === criticality &&
				baseData.editing === editing &&
				baseData.justCreated === just
			) {
				return n;
			}
			const data: TaskNodeData = {
				...baseData,
				criticality,
				justCreated: just,
				editing,
				onCommitEdit: editing
					? (next) => onCommitInlineEdit(taskId, next)
					: undefined,
				onCancelEdit: editing ? onCancelInlineEdit : undefined,
			};
			return { ...n, data: data as unknown as Record<string, unknown> };
		}
		if (n.type === "groupExpanded" || n.type === "groupCollapsed") {
			const groupId = n.id as GroupId;
			const baseData = n.data as unknown as GroupNodeData;
			const dropTarget = dragHoverGroupId === groupId;
			if (baseData.dropTarget === dropTarget) return n;
			const data: GroupNodeData = { ...baseData, dropTarget };
			return { ...n, data: data as unknown as Record<string, unknown> };
		}
		return n;
	});
}

function pushLeafNode(
	nodes: Node[],
	projected: Extract<ProjectedNode, { kind: "leaf" }>,
	fallback: ReturnType<typeof fallbackGridLayout>,
	schedule: Schedule | null,
	cycleTaskIds: ReadonlySet<TaskId>,
	onDeleteTask: (taskId: TaskId) => void,
	onAddLinkedTask: (
		sourceId: TaskId,
		direction: "successor" | "predecessor",
		kind: "task" | "milestone",
	) => void,
	display: ResolvedSurface<CanvasLayoutMode, CanvasFieldId>,
	staffing: ResolvedStaffing | null,
) {
	const task = projected.task;
	const pos = task.layout?.position ?? fallback[task.id] ?? { x: 0, y: 0 };
	const sched = schedule?.tasks[task.id];
	// PARALLEL-STAFFING badge: how many equal people could crash this task and
	// the resulting wall-clock, sized off the PERT expected (stable, basis- and
	// scaling-independent). Only meaningful when ≥2 people apply; the node also
	// gates on `showStaffing` (the display toggle).
	const staffingPeople =
		staffing && task.kind === "task"
			? peopleForDuration(sched?.expected ?? 0, staffing)
			: 1;
	const staffingDays =
		staffingPeople > 1 ? (sched?.expected ?? 0) / staffingPeople : undefined;
	const data: TaskNodeData = {
		title: task.title,
		kind: task.kind === "milestone" ? "milestone" : "task",
		// Show the PERT EXPECTED duration (stable, estimate-derived), not the
		// effective scheduling duration — the explainer reconciles the two.
		durationDays: sched?.expected ?? 0,
		durationExplain:
			task.kind === "task"
				? explainExpectedDuration(task.estimate, sched)
				: undefined,
		slackExplain:
			sched && task.kind === "task" ? explainSlack(sched) : undefined,
		mostLikelyDays: task.estimate?.mostLikely,
		slackDays: sched?.slack ?? null,
		critical: sched?.critical ?? false,
		hasEstimate: Boolean(task.estimate),
		issueKeys: task.issueKeys,
		cycle: cycleTaskIds.has(task.id),
		status: sched?.status ?? task.status ?? "not_started",
		progress: sched?.progress ?? task.progress ?? 0,
		criticality: undefined,
		justCreated: false,
		onDelete: () => onDeleteTask(task.id),
		editing: false,
		onCommitEdit: undefined,
		onCancelEdit: undefined,
		onAddPredecessor: (kind) => onAddLinkedTask(task.id, "predecessor", kind),
		onAddSuccessor: (kind) => onAddLinkedTask(task.id, "successor", kind),
		// DISPLAY-SETTINGS: per-project node field visibility + density.
		showDuration: display.fields.duration,
		showSlack: display.fields.slack,
		showProgress: display.fields.progress,
		showIssueKeys: display.fields.issueKeys,
		// PARALLEL-STAFFING: the badge shows only when the display field is on AND
		// the task actually crashes (≥2 people). staffingPeople/Days stay undefined
		// otherwise so the node renders nothing.
		showStaffing: display.fields.staffing,
		staffingPeople: staffingDays !== undefined ? staffingPeople : undefined,
		staffingDays,
		layout: display.layout,
	};
	nodes.push({
		id: task.id,
		type: "task",
		position: pos,
		data: data as unknown as Record<string, unknown>,
		width: TASK_WIDTH,
		height: TASK_HEIGHT,
		// Leaves sit above every group body and every edge, no matter how
		// deeply nested — they must always be visible and interactive.
		zIndex: LEAF_Z,
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
			// Sit above every group body (groups stack by nesting depth starting
			// at GROUP_BASE_Z) but below leaf task nodes, so an edge passing
			// through a group is never visually hidden while leaves still paint on
			// top of the edge stroke.
			zIndex: EDGE_Z,
		};
	});
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
			// Establishing the baseline: tasks that already exist on first mount
			// are never in `additions`, so we never pan to them. Drain their
			// local-origin flags now — otherwise an id created from another view
			// (e.g. table quick-add) before navigating here would linger in the
			// registry for the project's lifetime.
			for (const id of current) consumeLocallyCreated(id as TaskId);
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
		// Pan only to tasks THIS client created — UI edits and applied AI
		// proposals both flow through `changeDoc`, which marks them local. A
		// collaborator's addition arrives via Automerge sync and must NOT yank
		// our viewport; it still pulses (above) for awareness, but the camera
		// stays put. Consume the flag for every addition so the local-origin set
		// can't grow. For multi-task batches (e.g. AI tool loops), pan to the
		// first local one; the rest pulse in place.
		const targetId = additions.filter(consumeLocallyCreated)[0];
		if (targetId) {
			// The position may still be undefined on the doc — fall back to the
			// next animation frame so ELK/auto-layout has a chance to assign
			// positions first.
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
		}
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
	collapsed: ReadonlySet<GroupId>,
	maxLevel: number,
) {
	useEffect(() => {
		const tasksMissing = Object.values(doc.tasksById).some(
			(t) => !t.layout?.position,
		);
		// Only groups that actually render under the cap can receive a position
		// from computeLayout. A folded-away group (or any group when grouping is
		// off) intentionally never gets one, so it must NOT count as "missing" —
		// otherwise this effect would re-run ELK on every doc edit in capped/off
		// modes instead of staying idle once the initial layout is done.
		const groupsMissing = Object.values(doc.groupsById).some(
			(g) => isGroupRendered(doc, g.id, maxLevel) && !g.layout?.position,
		);
		if (!tasksMissing && !groupsMissing) return;
		let cancelled = false;
		computeLayout(doc, { spacing, collapsed, maxLevel }).then((positions) => {
			if (cancelled) return;
			changeDoc((d) => {
				for (const task of Object.values(d.tasksById)) {
					if (task.layout?.position) continue;
					const pos = positions[task.id];
					if (!pos) continue;
					task.layout = { ...(task.layout ?? {}), position: pos };
				}
				// Anchor collapsed / empty groups that have no stored position yet.
				for (const group of Object.values(d.groupsById)) {
					if (group.layout?.position) continue;
					const pos = positions[group.id];
					if (!pos) continue;
					group.layout = { ...(group.layout ?? {}), position: pos };
				}
			});
		});
		return () => {
			cancelled = true;
		};
	}, [doc, changeDoc, spacing, collapsed, maxLevel]);
}

// Continuous auto-layout. When enabled, every structural doc change (new
// node / edge, re-group, collapse toggle, kind switch) re-runs ELK and
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
	collapsed: ReadonlySet<GroupId>,
	maxLevel: number,
	enabled: boolean,
) {
	const reactFlow = useReactFlow();
	const structuralKey = useMemo(() => {
		const tasks = Object.values(doc.tasksById)
			.map((t) => `${t.id}|${t.groupId ?? ""}|${t.kind}`)
			.sort()
			.join(",");
		const groups = Object.values(doc.groupsById)
			.map(
				(g) =>
					`${g.id}|${g.parentGroupId ?? ""}|${collapsed.has(g.id) ? "c" : "e"}`,
			)
			.sort()
			.join(",");
		const deps = Object.values(doc.dependenciesById)
			.map((d) => `${d.from.taskId ?? "*"}->${d.to.taskId ?? "*"}`)
			.sort()
			.join(",");
		return `${tasks}::${groups}::${deps}::${spacing}::${maxLevel}`;
	}, [doc, collapsed, spacing, maxLevel]);

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
				maxLevel,
			});
			if (cancelled) return;
			// Apply positions. Expanded groups derive their box from member
			// bounds, so writing their position is harmless. Skip writes when the
			// computed position is effectively unchanged — an Automerge change of
			// N positions is O(N) and was firing for every node on every
			// structural edit, even when ELK returned the same layout as before.
			changeDoc((d) => {
				for (const task of Object.values(d.tasksById)) {
					const pos = positions[task.id];
					if (!pos) continue;
					const current = task.layout?.position;
					if (
						current &&
						Math.abs(current.x - pos.x) < 0.5 &&
						Math.abs(current.y - pos.y) < 0.5
					) {
						continue;
					}
					task.layout = { ...(task.layout ?? {}), position: pos };
				}
				for (const group of Object.values(d.groupsById)) {
					const pos = positions[group.id];
					if (!pos) continue;
					const current = group.layout?.position;
					if (
						current &&
						Math.abs(current.x - pos.x) < 0.5 &&
						Math.abs(current.y - pos.y) < 0.5
					) {
						continue;
					}
					group.layout = { ...(group.layout ?? {}), position: pos };
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
	groupId: GroupId | null,
	onCreated?: (id: TaskId) => void,
) {
	const id = newId("task");
	changeDoc((d) => {
		const base: Task = {
			id,
			kind,
			title: kind === "milestone" ? "New milestone" : "New task",
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
		if (groupId && d.groupsById[groupId]) {
			assignTaskToGroupMutation(d, { taskId: id, groupId });
		}
	});
	onCreated?.(id);
}

function removeTaskFromDoc(
	changeDoc: (mutate: (d: PertDoc) => void) => void,
	taskId: TaskId,
) {
	changeDoc((d) => {
		delete d.tasksById[taskId];
		for (const [depId, dep] of Object.entries(d.dependenciesById)) {
			if (dep.from.taskId === taskId || dep.to.taskId === taskId) {
				delete d.dependenciesById[depId];
			}
		}
	});
}

function newId(prefix: string): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `${prefix}_${s}`;
}

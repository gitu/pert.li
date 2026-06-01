import { useStore } from "@tanstack/react-store";
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import {
	ArrowDownIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	FolderIcon,
	LayersIcon,
	PencilIcon,
	PlusIcon,
	SettingsIcon,
	ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	KeyboardShortcutsHelp,
	TABLE_SHORTCUTS,
} from "#/components/pert/keyboard-shortcuts-help";
import { PresenceBadge } from "#/components/pert/presence/presence-badge";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { addDependencyMutation, addTaskMutation } from "#/lib/ai/tool-mutators";
import { todayIsoDate } from "#/lib/pert/calendar";
import { computeSchedule, type ScheduleResult } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore, selectTask } from "#/lib/pert/store";
import {
	countRowsInGroup,
	groupTasksByKey,
	type KeyGroupNode,
} from "#/lib/pert/task-key";
import type {
	Estimate,
	PertDoc,
	TaskId,
	TaskKind,
	TaskStatus,
} from "#/lib/pert/types";
import { cn } from "#/lib/utils";

export type TaskListViewProps = {
	projectId: string;
	doc: PertDoc;
};

export type TaskListRow = {
	id: TaskId;
	title: string;
	kind: TaskKind;
	key: string | undefined;
	estimate: Estimate | undefined;
	duration: number;
	es: number | null;
	ef: number | null;
	slack: number | null;
	critical: boolean;
	// Status drives whether the Started / Finished date cells are editable.
	// "not_started" hides the dates; in_progress allows Started; completed
	// allows both.
	taskStatus: TaskStatus;
	actualStart: string | undefined;
	actualFinish: string | undefined;
	// 0-100 from the doc; for the row's display value we follow the same
	// "completed implies 100, not_started implies 0" semantics the
	// inspector uses (the column cell does the final clamp).
	progress: number | undefined;
};

// Pure derivation of list rows from a doc + already-computed schedule. Lives
// alongside the component so unit tests can exercise sorting and the
// container-exclusion rule without mounting React.
export function buildTaskListRows(
	doc: PertDoc,
	scheduleResult: ScheduleResult,
): TaskListRow[] {
	const sched = scheduleResult.ok ? scheduleResult.schedule : null;
	return Object.values(doc.tasksById)
		.filter((t) => t.kind !== "container")
		.map((t): TaskListRow => {
			const s = sched?.tasks[t.id];
			return {
				id: t.id,
				title: t.title,
				kind: t.kind,
				key: t.key,
				estimate: t.estimate,
				duration: s?.duration ?? 0,
				es: s?.earliestStart ?? null,
				ef: s?.earliestFinish ?? null,
				slack: s?.slack ?? null,
				critical: s?.critical ?? false,
				taskStatus: t.status ?? "not_started",
				actualStart: t.actualStart,
				actualFinish: t.actualFinish,
				progress: t.progress,
			};
		})
		.sort((a, b) => {
			const ea = a.es ?? Number.POSITIVE_INFINITY;
			const eb = b.es ?? Number.POSITIVE_INFINITY;
			if (ea !== eb) return ea - eb;
			return a.title.localeCompare(b.title);
		});
}

// Column-visibility persistence: two profiles (view + edit) live in
// localStorage so a user's preferred column set survives reloads. Reset
// restores both to defaults. Keys are versioned so a future schema change
// can ignore stale shapes.
const COL_VIS_KEYS = {
	view: "pertli.taskList.columnVis.view.v1",
	edit: "pertli.taskList.columnVis.edit.v1",
} as const;

// View mode shows the full set of columns by default — leaving Edit should
// drop the user back into a wide informational layout (CPM internals,
// status, dates, etc.).
const DEFAULT_VIEW_COLUMN_VISIBILITY: VisibilityState = {};

// Edit mode focuses on the cells that are actually editable inline — key,
// title, estimate, started/finished dates, and progress. The computed-
// schedule columns are read-only and would just be noise while tabbing
// through edits; users can opt them back in via the Columns dropdown and
// we'll persist that choice.
const DEFAULT_EDIT_COLUMN_VISIBILITY: VisibilityState = {
	kind: false,
	duration: false,
	es: false,
	ef: false,
	slack: false,
	status: false,
};

function readPersistedColumnVisibility(key: string): VisibilityState | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as VisibilityState;
		}
		return null;
	} catch {
		return null;
	}
}

function writePersistedColumnVisibility(key: string, value: VisibilityState) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// quota / disabled storage — drop silently
	}
}

// Tabular view of the same task graph the canvas renders. Selection is the
// shared store, so clicks here light the canvas + the inspector and vice
// versa. Container tasks are hidden — they belong to the canvas in Phase 5.
//
// Phase 6 upgrade: TanStack Table powers sorting, column visibility, and
// global filter. Double-click on the title cell starts an inline edit that
// commits straight back into the Automerge doc through projectDocStore.
export function TaskListView({ projectId, doc }: TaskListViewProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);
	const changeDoc = useStore(projectDocStore, (s) =>
		s.projectId === projectId ? s.changeDoc : null,
	);

	const rows = useMemo(
		() => buildTaskListRows(doc, scheduleResult),
		[doc, scheduleResult],
	);

	const [sorting, setSorting] = useState<SortingState>([
		{ id: "es", desc: false },
	]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	// "Edit all" mode flips every editable cell into its input variant at
	// once, so the user can tab through and modify the whole table without
	// double-clicking each cell. Declared early because column visibility
	// below picks the active profile (view vs edit) based on it.
	const [editAll, setEditAll] = useState(false);
	// Column visibility has two independent profiles — one for the read-only
	// view (focused, hides CPM internals) and one for the all-cells-editable
	// view (shows everything by default since the user explicitly opened
	// "Edit"). Each profile is persisted to localStorage so a user's
	// preferred layout sticks across reloads.
	const [viewColumnVisibility, setViewColumnVisibility] =
		useState<VisibilityState>(
			() =>
				readPersistedColumnVisibility(COL_VIS_KEYS.view) ??
				DEFAULT_VIEW_COLUMN_VISIBILITY,
		);
	const [editColumnVisibility, setEditColumnVisibility] =
		useState<VisibilityState>(
			() =>
				readPersistedColumnVisibility(COL_VIS_KEYS.edit) ??
				DEFAULT_EDIT_COLUMN_VISIBILITY,
		);
	const [columnsOpen, setColumnsOpen] = useState(false);
	// "Active" view-vs-edit visibility — flips automatically with editAll so
	// the user can have one focused layout for skimming and a wider layout
	// for bulk editing without manually rearranging columns each time.
	const activeColumnVisibility = editAll
		? editColumnVisibility
		: viewColumnVisibility;
	const setActiveColumnVisibility = useCallback(
		(updater: (prev: VisibilityState) => VisibilityState) => {
			if (editAll) {
				setEditColumnVisibility((prev) => {
					const next = updater(prev);
					writePersistedColumnVisibility(COL_VIS_KEYS.edit, next);
					return next;
				});
			} else {
				setViewColumnVisibility((prev) => {
					const next = updater(prev);
					writePersistedColumnVisibility(COL_VIS_KEYS.view, next);
					return next;
				});
			}
		},
		[editAll],
	);
	const resetColumnVisibility = useCallback(() => {
		setViewColumnVisibility(DEFAULT_VIEW_COLUMN_VISIBILITY);
		setEditColumnVisibility(DEFAULT_EDIT_COLUMN_VISIBILITY);
		writePersistedColumnVisibility(
			COL_VIS_KEYS.view,
			DEFAULT_VIEW_COLUMN_VISIBILITY,
		);
		writePersistedColumnVisibility(
			COL_VIS_KEYS.edit,
			DEFAULT_EDIT_COLUMN_VISIBILITY,
		);
	}, []);
	const [globalFilter, setGlobalFilter] = useState("");
	const [editingId, setEditingId] = useState<TaskId | null>(null);
	// Estimate editing is keyed separately so it can be live alongside (or
	// instead of) title editing on a different row without one cancelling
	// the other on focus changes.
	const [editingEstimateId, setEditingEstimateId] = useState<TaskId | null>(
		null,
	);
	const [editingKeyId, setEditingKeyId] = useState<TaskId | null>(null);
	// Started / Finished date cells. Two independent editing keys so the user
	// can flip Finished without losing the in-flight value in Started on the
	// same row (and vice versa).
	const [editingActualStartId, setEditingActualStartId] =
		useState<TaskId | null>(null);
	const [editingActualFinishId, setEditingActualFinishId] =
		useState<TaskId | null>(null);
	const [editingProgressId, setEditingProgressId] = useState<TaskId | null>(
		null,
	);
	// Group rows by their dotted `key`. Collapsed group paths live in a
	// separate set so flipping the toggle off and back on keeps the user's
	// open/closed state instead of resetting.
	const [grouped, setGrouped] = useState(false);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
		() => new Set(),
	);
	const toggleGroup = useCallback((path: string) => {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	// Quick-add row state. The form sits at the bottom of the table and
	// commits a new task on Enter — far faster than opening the canvas to
	// drop one in. cmd/ctrl + Enter focuses the title input from anywhere
	// in the table, so power users can chain creations without reaching
	// for the mouse.
	const [quickAddTitle, setQuickAddTitle] = useState("");
	const [quickAddEstimate, setQuickAddEstimate] = useState("");
	const quickAddTitleRef = useRef<HTMLInputElement | null>(null);
	const focusQuickAdd = useCallback(() => {
		quickAddTitleRef.current?.focus();
		quickAddTitleRef.current?.select();
	}, []);
	const submitQuickAdd = useCallback(
		(kind: "task" | "milestone") => {
			if (!changeDoc) return;
			const title = quickAddTitle.trim();
			if (!title) return;
			let estimate: Estimate | undefined;
			if (kind === "task") {
				const m = Number.parseFloat(quickAddEstimate);
				const mostLikely = Number.isFinite(m) && m > 0 ? m : 2;
				estimate = {
					optimistic: Math.max(0.25, mostLikely / 2),
					mostLikely,
					pessimistic: mostLikely * 2,
					unit: "day",
				};
			}
			changeDoc((d) => {
				const { id } = addTaskMutation(d, {
					title,
					estimate,
					kind,
				});
				selectTask(projectId, id);
			});
			setQuickAddTitle("");
			setQuickAddEstimate("");
			// Re-focus so the user can keep adding without grabbing the
			// mouse.
			window.setTimeout(() => focusQuickAdd(), 0);
		},
		[changeDoc, focusQuickAdd, projectId, quickAddEstimate, quickAddTitle],
	);

	// Insert a fresh task adjacent to a seed row. The new task inherits the
	// seed's parent, and we wire a dependency so it sorts where the user
	// expects: below = `seed → new` (new becomes a successor), above =
	// `new → seed` (new becomes a predecessor). Selecting + flipping into
	// inline-edit mirrors the canvas Tab-spawn experience.
	const insertAdjacentRow = useCallback(
		(seedId: TaskId, position: "above" | "below") => {
			if (!changeDoc) return;
			const seed = doc.tasksById[seedId];
			if (!seed) return;
			const parentId = seed.parentId ?? null;
			let newTaskId: TaskId | null = null;
			changeDoc((d) => {
				const { id } = addTaskMutation(d, {
					title: "",
					kind: "task",
					parentId,
				});
				newTaskId = id;
				const fromId = position === "below" ? seedId : id;
				const toId = position === "below" ? id : seedId;
				addDependencyMutation(d, { fromTaskId: fromId, toTaskId: toId });
			});
			if (newTaskId) {
				selectTask(projectId, newTaskId);
				setEditingId(newTaskId);
			}
		},
		[changeDoc, doc.tasksById, projectId],
	);

	// Indent / outdent the selected row. Indent copies the parentId of the
	// previous visible row (so the row drops into the same container as the
	// one above it). Outdent walks up: if the row is already nested, set its
	// parent to its current parent's parent. No-op when there's no parent to
	// inherit / promote from, matching outliner intuition.
	const indentRow = useCallback(
		(rowId: TaskId, prevRowId: TaskId | null) => {
			if (!changeDoc) return;
			if (!prevRowId) return;
			const prev = doc.tasksById[prevRowId];
			if (!prev) return;
			const targetParent = prev.parentId ?? null;
			const row = doc.tasksById[rowId];
			if (!row) return;
			if ((row.parentId ?? null) === targetParent) return;
			if (!targetParent) return; // nothing to indent into
			changeDoc((d) => {
				const t = d.tasksById[rowId];
				if (!t) return;
				t.parentId = targetParent;
			});
		},
		[changeDoc, doc.tasksById],
	);
	const outdentRow = useCallback(
		(rowId: TaskId) => {
			if (!changeDoc) return;
			const row = doc.tasksById[rowId];
			if (!row?.parentId) return;
			const parent = doc.tasksById[row.parentId];
			const grandparent = parent?.parentId ?? null;
			changeDoc((d) => {
				const t = d.tasksById[rowId];
				if (!t) return;
				t.parentId = grandparent;
			});
		},
		[changeDoc, doc.tasksById],
	);

	// The full set of keyboard shortcuts for the table view. Stays consistent
	// with the canvas keynav vocabulary (n adds, Tab indents, arrows move).
	//   • n / ⌘I        — focus the quick-add row
	//   • ↑/↓           — move selection across visible rows
	//   • Enter         — inline-edit the selected row's title
	//   • o             — insert a task BELOW the selection
	//   • Shift+O       — insert a task ABOVE the selection
	//   • Tab           — indent (parent = previous row's parent)
	//   • Shift+Tab     — outdent (parent = current grandparent)
	//   • Esc           — clear selection
	// Bound via a ref so the effect re-runs only when the bindings change,
	// not on every doc edit.
	const visibleRowsRef = useRef<TaskId[]>([]);
	const handlerStateRef = useRef({
		focusQuickAdd,
		insertAdjacentRow,
		indentRow,
		outdentRow,
		setEditingId,
		projectId,
	});
	handlerStateRef.current = {
		focusQuickAdd,
		insertAdjacentRow,
		indentRow,
		outdentRow,
		setEditingId,
		projectId,
	};
	useEffect(() => {
		if (!changeDoc) return;
		const handler = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			const target = e.target as HTMLElement | null;
			const inInput =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable === true;
			const ctx = handlerStateRef.current;
			const orderedIds = visibleRowsRef.current;
			const selectedId = selectionStore.state.taskId;
			const selectedInProject =
				selectionStore.state.projectId === ctx.projectId && selectedId;

			// Quick-add focus shortcuts.
			const isModI = (e.metaKey || e.ctrlKey) && e.key === "i";
			const isPlainN = !inInput && e.key === "n" && !e.metaKey && !e.ctrlKey;
			if (isModI || isPlainN) {
				e.preventDefault();
				ctx.focusQuickAdd();
				return;
			}
			if (inInput) return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;

			if (e.key === "Escape") {
				if (selectedInProject) {
					e.preventDefault();
					selectTask(ctx.projectId, null);
				}
				return;
			}

			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				if (orderedIds.length === 0) return;
				e.preventDefault();
				const currentIndex = selectedInProject
					? orderedIds.indexOf(selectedId as TaskId)
					: -1;
				let nextIndex: number;
				if (e.key === "ArrowDown") {
					nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
					if (nextIndex >= orderedIds.length) nextIndex = orderedIds.length - 1;
				} else {
					nextIndex =
						currentIndex < 0
							? orderedIds.length - 1
							: Math.max(0, currentIndex - 1);
				}
				const nextId = orderedIds[nextIndex];
				if (nextId) selectTask(ctx.projectId, nextId);
				return;
			}

			if (e.key === "Enter") {
				if (!selectedInProject) return;
				e.preventDefault();
				ctx.setEditingId(selectedId as TaskId);
				return;
			}

			if (e.key === "o" && !e.shiftKey) {
				if (!selectedInProject) return;
				e.preventDefault();
				ctx.insertAdjacentRow(selectedId as TaskId, "below");
				return;
			}
			if (e.key === "O" && e.shiftKey) {
				if (!selectedInProject) return;
				e.preventDefault();
				ctx.insertAdjacentRow(selectedId as TaskId, "above");
				return;
			}

			if (e.key === "Tab") {
				if (!selectedInProject) return;
				e.preventDefault();
				if (e.shiftKey) {
					ctx.outdentRow(selectedId as TaskId);
				} else {
					const idx = orderedIds.indexOf(selectedId as TaskId);
					const prevId = idx > 0 ? orderedIds[idx - 1] : null;
					ctx.indentRow(selectedId as TaskId, prevId);
				}
				return;
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [changeDoc]);

	const columns = useMemo<ColumnDef<TaskListRow>[]>(
		() => [
			{
				accessorKey: "key",
				header: "Key",
				size: 120,
				cell: ({ row }) => {
					const r = row.original;
					const editing = editAll || editingKeyId === r.id;
					if (editing && changeDoc) {
						return (
							<KeyEdit
								initial={r.key ?? ""}
								autoFocus={!editAll}
								onCommit={(value) => {
									const trimmed = value.trim();
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										if (trimmed.length === 0) delete t.key;
										else t.key = trimmed;
									});
									if (!editAll) setEditingKeyId(null);
								}}
								onCancel={() => {
									if (!editAll) setEditingKeyId(null);
								}}
							/>
						);
					}
					return (
						<button
							type="button"
							className="w-full text-left font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-default"
							disabled={!changeDoc}
							onDoubleClick={(ev) => {
								ev.stopPropagation();
								if (changeDoc) setEditingKeyId(r.id);
							}}
							title={changeDoc ? "Double-click to edit the key" : undefined}
						>
							{r.key ?? <span className="text-muted-foreground/60">—</span>}
						</button>
					);
				},
			},
			{
				accessorKey: "title",
				header: "Title",
				size: 320,
				cell: ({ row }) => {
					const r = row.original;
					// In "edit all" mode every title is an input by default; in the
					// normal mode we only swap the cell that was double-clicked.
					const editing = editAll || editingId === r.id;
					return (
						<div className="flex items-center gap-2">
							<KindIcon kind={r.kind} critical={r.critical} />
							{editing && changeDoc ? (
								<TitleEdit
									initial={r.title}
									autoFocus={!editAll}
									onCommit={(value) => {
										changeDoc((d) => {
											const t = d.tasksById[r.id];
											if (t) t.title = value;
										});
										if (!editAll) setEditingId(null);
									}}
									onCancel={() => {
										if (!editAll) setEditingId(null);
									}}
								/>
							) : (
								<button
									type="button"
									className="truncate text-left"
									onDoubleClick={(e) => {
										e.stopPropagation();
										if (changeDoc) setEditingId(r.id);
									}}
									title={
										changeDoc ? "Double-click to rename" : r.title || "Untitled"
									}
								>
									{r.title || (
										<span className="italic text-muted-foreground">
											Untitled
										</span>
									)}
								</button>
							)}
							<PresenceBadge taskId={r.id} />
						</div>
					);
				},
				filterFn: (row, _id, filter) => {
					const needle = String(filter ?? "").toLowerCase();
					if (!needle) return true;
					const r = row.original;
					return (
						r.title.toLowerCase().includes(needle) ||
						r.id.toLowerCase().includes(needle)
					);
				},
			},
			{
				accessorKey: "kind",
				header: "Kind",
				cell: ({ row }) => (
					<span className="text-xs capitalize text-muted-foreground">
						{row.original.kind}
					</span>
				),
				size: 90,
			},
			{
				accessorKey: "estimate",
				header: () => <div className="text-right">Estimate</div>,
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					const editing = editAll || editingEstimateId === r.id;
					if (editing && changeDoc && r.kind !== "milestone") {
						return (
							<EstimateEdit
								initial={
									r.estimate ?? {
										optimistic: 1,
										mostLikely: 2,
										pessimistic: 4,
										unit: "day",
									}
								}
								// Auto-focus only when the user opted into a specific
								// cell — in bulk "edit all" mode we'd otherwise yank
								// focus into the first cell on every render.
								autoFocus={!editAll}
								onCommit={(next) => {
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										t.estimate = next;
									});
									if (!editAll) setEditingEstimateId(null);
								}}
								onCancel={() => {
									if (!editAll) setEditingEstimateId(null);
								}}
							/>
						);
					}
					const e = r.estimate;
					return (
						<button
							type="button"
							className="w-full text-right text-xs text-muted-foreground tabular-nums hover:text-foreground disabled:cursor-default"
							disabled={!changeDoc || r.kind === "milestone"}
							onDoubleClick={(ev) => {
								ev.stopPropagation();
								if (changeDoc && r.kind !== "milestone") {
									setEditingEstimateId(r.id);
								}
							}}
							title={
								r.kind === "milestone"
									? "Milestones don't have estimates"
									: changeDoc
										? "Double-click to edit"
										: undefined
							}
						>
							{e
								? `${e.optimistic} / ${e.mostLikely} / ${e.pessimistic} ${e.unit[0]}`
								: "—"}
						</button>
					);
				},
				size: 180,
			},
			{
				accessorKey: "duration",
				header: () => <div className="text-right">Dur</div>,
				cell: ({ getValue }) => (
					<div className="text-right tabular-nums">
						{fmt(getValue() as number)}
					</div>
				),
				size: 70,
			},
			{
				accessorKey: "es",
				header: () => <div className="text-right">ES</div>,
				cell: ({ getValue }) => (
					<div className="text-right tabular-nums">
						{fmtNullable(getValue() as number | null)}
					</div>
				),
				sortingFn: nullableNumberSort,
				size: 70,
			},
			{
				accessorKey: "ef",
				header: () => <div className="text-right">EF</div>,
				cell: ({ getValue }) => (
					<div className="text-right tabular-nums">
						{fmtNullable(getValue() as number | null)}
					</div>
				),
				sortingFn: nullableNumberSort,
				size: 70,
			},
			{
				accessorKey: "slack",
				header: () => <div className="text-right">Slack</div>,
				cell: ({ getValue }) => (
					<div className="text-right tabular-nums">
						{fmtNullable(getValue() as number | null)}
					</div>
				),
				sortingFn: nullableNumberSort,
				size: 70,
			},
			{
				id: "status",
				header: "Status",
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					if (r.critical) return <Badge variant="destructive">critical</Badge>;
					if (r.slack !== null) return <Badge variant="secondary">slack</Badge>;
					return <Badge variant="outline">—</Badge>;
				},
				size: 90,
			},
			{
				accessorKey: "actualStart",
				header: "Started",
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					// Started is editable as soon as a task is in_progress or
					// completed. Tasks the user hasn't touched yet render an inert
					// placeholder — they don't have an actual start by definition.
					const editable =
						r.kind !== "milestone" &&
						r.taskStatus !== "not_started" &&
						!!changeDoc;
					const editing =
						editable && (editAll || editingActualStartId === r.id);
					if (editing && changeDoc) {
						return (
							<DateEdit
								value={r.actualStart}
								autoFocus={!editAll}
								onCommit={(next) => {
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										if (next) t.actualStart = next;
										else delete t.actualStart;
									});
									if (!editAll) setEditingActualStartId(null);
								}}
								onCancel={() => {
									if (!editAll) setEditingActualStartId(null);
								}}
								data-testid="task-list-actual-start"
							/>
						);
					}
					return (
						<DateCellButton
							value={r.actualStart}
							disabled={!editable}
							hint={
								r.kind === "milestone"
									? "Milestones don't track start dates"
									: r.taskStatus === "not_started"
										? "Mark the task in progress to set a start date"
										: "Double-click to edit"
							}
							onActivate={() => setEditingActualStartId(r.id)}
						/>
					);
				},
				size: 140,
			},
			{
				accessorKey: "actualFinish",
				header: "Finished",
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					// Finished is editable for completed tasks; for in_progress we
					// also allow it (the user might want to log the actual finish
					// before flipping status). Hidden / inert for not_started.
					const editable =
						r.kind !== "milestone" &&
						r.taskStatus !== "not_started" &&
						!!changeDoc;
					const editing =
						editable && (editAll || editingActualFinishId === r.id);
					if (editing && changeDoc) {
						return (
							<DateEdit
								value={r.actualFinish}
								autoFocus={!editAll}
								onCommit={(next) => {
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										if (next) t.actualFinish = next;
										else delete t.actualFinish;
									});
									if (!editAll) setEditingActualFinishId(null);
								}}
								onCancel={() => {
									if (!editAll) setEditingActualFinishId(null);
								}}
								data-testid="task-list-actual-finish"
							/>
						);
					}
					return (
						<DateCellButton
							value={r.actualFinish}
							disabled={!editable}
							hint={
								r.kind === "milestone"
									? "Milestones don't track finish dates"
									: r.taskStatus === "not_started"
										? "Mark the task in progress to set a finish date"
										: "Double-click to edit"
							}
							onActivate={() => setEditingActualFinishId(r.id)}
						/>
					);
				},
				size: 140,
			},
			{
				accessorKey: "progress",
				header: () => <div className="text-right">Progress</div>,
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					// Editable for tasks (not milestones / containers) regardless of
					// status — bumping progress from 0 implicitly flips the status to
					// "in_progress", matching the inspector's logic.
					const editable = r.kind !== "milestone" && !!changeDoc;
					const editing = editable && (editAll || editingProgressId === r.id);
					const displayValue =
						r.taskStatus === "completed"
							? 100
							: r.taskStatus === "not_started"
								? 0
								: (r.progress ?? 0);
					if (editing && changeDoc) {
						return (
							<ProgressEdit
								initial={displayValue}
								autoFocus={!editAll}
								onCommit={(next) => {
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										const clamped = Math.max(
											0,
											Math.min(100, Math.round(next)),
										);
										t.progress = clamped;
										// Mirror the inspector's side effects so the status
										// + dates stay consistent with the percentage.
										if (
											t.status !== "in_progress" &&
											t.status !== "completed" &&
											clamped > 0
										) {
											t.status = "in_progress";
											if (!t.actualStart) t.actualStart = todayIsoDate();
										}
										if (clamped >= 100) {
											t.status = "completed";
											if (!t.actualFinish) t.actualFinish = todayIsoDate();
										} else if (t.status === "completed") {
											t.status = "in_progress";
											delete t.actualFinish;
										}
									});
									if (!editAll) setEditingProgressId(null);
								}}
								onCancel={() => {
									if (!editAll) setEditingProgressId(null);
								}}
							/>
						);
					}
					if (!editable) {
						return (
							<div className="text-right text-xs text-muted-foreground/60">
								—
							</div>
						);
					}
					return (
						<button
							type="button"
							className="w-full text-right text-xs text-muted-foreground tabular-nums hover:text-foreground"
							onDoubleClick={(ev) => {
								ev.stopPropagation();
								setEditingProgressId(r.id);
							}}
							title="Double-click to edit progress"
						>
							{displayValue}%
						</button>
					);
				},
				size: 100,
			},
		],
		[
			editingId,
			editingEstimateId,
			editingKeyId,
			editingActualStartId,
			editingActualFinishId,
			editingProgressId,
			editAll,
			changeDoc,
		],
	);

	const table = useReactTable({
		data: rows,
		columns,
		state: {
			sorting,
			columnFilters,
			columnVisibility: activeColumnVisibility,
			globalFilter,
		},
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: (updater) => {
			setActiveColumnVisibility((prev) =>
				typeof updater === "function" ? updater(prev) : updater,
			);
		},
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _id, value) => {
			const needle = String(value ?? "").toLowerCase();
			if (!needle) return true;
			const r = row.original;
			return (
				r.title.toLowerCase().includes(needle) ||
				r.id.toLowerCase().includes(needle) ||
				r.kind.toLowerCase().includes(needle)
			);
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getRowId: (row) => row.id,
	});

	const visibleRows = table.getRowModel().rows;
	// When grouping is on, build a tree once per render from the rows TanStack
	// already filtered/sorted. The visible TanStack rows map keeps the cell
	// renderers consistent — we look up by id when we want to flexRender a
	// task row inside a group.
	const groupedTree = useMemo(() => {
		if (!grouped) return null;
		const tree = groupTasksByKey(visibleRows.map((r) => r.original));
		return tree;
	}, [grouped, visibleRows]);
	const visibleRowById = useMemo(
		() => new Map(visibleRows.map((r) => [r.original.id, r])),
		[visibleRows],
	);
	const visibleColumnCount = table.getVisibleLeafColumns().length;
	// Keep the keynav effect's row-order ref in sync with what's actually
	// rendered. Reads from visibleRows so it reflects filter + sort, not the
	// raw doc order — pressing ↓ should move to the row the user sees below
	// the current one, not the next id alphabetically.
	visibleRowsRef.current = visibleRows.map((r) => r.original.id);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
				<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Tasks · {visibleRows.length}
					{visibleRows.length !== rows.length && ` / ${rows.length}`}
				</div>
				<div className="flex items-center gap-2">
					<Input
						value={globalFilter}
						onChange={(e) => setGlobalFilter(e.target.value)}
						placeholder="Filter tasks…"
						className="h-7 w-44 text-xs"
						data-testid="task-list-filter"
					/>
					<Button
						variant={grouped ? "default" : "outline"}
						size="sm"
						className="h-7 gap-1.5 text-xs"
						onClick={() => {
							setGrouped((v) => !v);
							setColumnsOpen(false);
						}}
						aria-pressed={grouped}
						data-testid="task-list-group"
						title={
							grouped
								? "Flatten the table"
								: "Group tasks by their dotted key (e.g. M1.A)"
						}
					>
						<LayersIcon className="size-3.5" />
						{grouped ? "Grouped" : "Group"}
					</Button>
					<Button
						variant={editAll ? "default" : "outline"}
						size="sm"
						className="h-7 gap-1.5 text-xs"
						onClick={() => {
							setEditAll((v) => !v);
							setColumnsOpen(false);
						}}
						disabled={!changeDoc}
						aria-pressed={editAll}
						data-testid="task-list-edit-all"
						title={
							editAll
								? "Exit edit mode — return to read-only view"
								: "Edit all rows at once without double-clicking"
						}
					>
						{editAll ? (
							<CheckIcon className="size-3.5" />
						) : (
							<PencilIcon className="size-3.5" />
						)}
						{editAll ? "Done" : "Edit"}
					</Button>
					<DropdownMenu
						open={columnsOpen}
						// `modal={false}` lets clicks on the toolbar buttons behind us
						// reach their own onClick handlers (Done / Group close the menu
						// via setColumnsOpen). In Radix's default modal mode an invisible
						// overlay would swallow those clicks.
						modal={false}
						// Outside-click, Escape, and item-select are all preventDefault-ed
						// on the Content below — so any onOpenChange that fires here can
						// only be Radix's Trigger detecting a click on the button itself.
						// Letting it through means both opening AND closing work via the
						// Columns button without us juggling a second onClick (which
						// races Radix's via asChild + Slot composition).
						onOpenChange={setColumnsOpen}
					>
						<DropdownMenuTrigger asChild>
							<Button
								variant={columnsOpen ? "secondary" : "outline"}
								size="sm"
								className="h-7 gap-1.5 text-xs"
								data-testid="task-list-columns"
							>
								<SettingsIcon className="size-3.5" />
								Columns
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="w-48"
							onInteractOutside={(e) => e.preventDefault()}
							onEscapeKeyDown={(e) => e.preventDefault()}
						>
							<div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
								{editAll ? "Edit columns" : "View columns"}
							</div>
							{table
								.getAllLeafColumns()
								.filter((c) => c.id !== "title")
								.map((col) => (
									<DropdownMenuCheckboxItem
										key={col.id}
										checked={col.getIsVisible()}
										onCheckedChange={(value) =>
											col.toggleVisibility(Boolean(value))
										}
										// Prevent the default "close menu on select" behavior so
										// the user can tick / untick several columns in one go.
										onSelect={(e) => e.preventDefault()}
										className="text-xs capitalize"
									>
										{col.id}
									</DropdownMenuCheckboxItem>
								))}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={(e) => {
									e.preventDefault();
									resetColumnVisibility();
								}}
								className="text-xs text-muted-foreground"
								data-testid="task-list-columns-reset"
							>
								Reset to default
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<KeyboardShortcutsHelp
						groups={TABLE_SHORTCUTS}
						testId="task-list-keyboard-help"
						tooltip="Table keyboard shortcuts"
					/>
					{scheduleResult.ok ? (
						<span className="text-xs text-muted-foreground">
							Project {fmt(scheduleResult.schedule.projectDuration)} d
						</span>
					) : (
						<span className="text-xs text-destructive">Cycle detected</span>
					)}
				</div>
			</header>
			<div className="flex-1 overflow-auto">
				{visibleRows.length === 0 && !changeDoc ? (
					// Read-only with nothing to show: keep the friendly empty
					// state. When the view is editable we always render the table
					// chrome below so the quick-add row stays reachable.
					rows.length === 0 ? (
						<EmptyList />
					) : (
						<NoMatches onClear={() => setGlobalFilter("")} />
					)
				) : (
					<Table data-testid="task-list-table">
						<TableHeader>
							{table.getHeaderGroups().map((group) => (
								<TableRow key={group.id}>
									{group.headers.map((header) => {
										const sort = header.column.getIsSorted();
										const sortable = header.column.getCanSort();
										return (
											<TableHead
												key={header.id}
												style={{ width: header.getSize() }}
											>
												{sortable ? (
													<button
														type="button"
														onClick={header.column.getToggleSortingHandler()}
														className="inline-flex items-center gap-1 text-left hover:text-foreground"
													>
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
														<SortIndicator sort={sort} />
													</button>
												) : (
													flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)
												)}
											</TableHead>
										);
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{visibleRows.length === 0 ? (
								// Editable empty state — the quick-add row below is the
								// affordance, so this just describes what's happening.
								// `rows.length === 0` separates "no tasks at all" from
								// "filter matched nothing"; the latter offers a clear-filter
								// button so the user isn't stuck.
								<TableRow data-testid="task-list-empty-placeholder">
									<TableCell
										colSpan={visibleColumnCount}
										className="text-center text-xs text-muted-foreground"
									>
										{rows.length === 0 ? (
											<span>
												No tasks yet — use the quick-add row below to start.
											</span>
										) : (
											<span className="inline-flex items-center gap-2">
												No tasks match the filter.
												<Button
													variant="link"
													className="h-auto p-0 text-xs"
													onClick={() => setGlobalFilter("")}
												>
													Clear filter
												</Button>
											</span>
										)}
									</TableCell>
								</TableRow>
							) : grouped && groupedTree ? (
								renderGroupedRows({
									tree: groupedTree,
									depth: 0,
									collapsedGroups,
									toggleGroup,
									visibleRowById,
									selectedTaskId,
									projectId,
									columnCount: visibleColumnCount,
								})
							) : (
								visibleRows.map((row) =>
									renderFlatTaskRow({
										row,
										selectedTaskId,
										projectId,
										indent: 0,
									}),
								)
							)}
							{changeDoc && (
								<TableRow
									data-testid="task-list-quick-add"
									className="bg-muted/20 hover:bg-muted/30"
								>
									<TableCell colSpan={visibleColumnCount} className="px-3 py-2">
										<div className="flex flex-wrap items-center gap-2">
											<PlusIcon className="size-3.5 text-muted-foreground" />
											<Input
												ref={quickAddTitleRef}
												value={quickAddTitle}
												onChange={(e) => setQuickAddTitle(e.target.value)}
												placeholder="Add a task… (Enter — Shift+Enter for milestone)"
												className="h-7 min-w-0 flex-1 text-xs"
												data-testid="task-list-quick-add-title"
												onKeyDown={(e) => {
													if (e.key === "Enter" && e.shiftKey) {
														// Shift+Enter commits as milestone — paired with
														// the dedicated button so power users don't have
														// to reach for the mouse to choose the kind.
														e.preventDefault();
														submitQuickAdd("milestone");
													} else if (e.key === "Enter") {
														e.preventDefault();
														submitQuickAdd("task");
													} else if (e.key === "Escape") {
														e.preventDefault();
														setQuickAddTitle("");
														setQuickAddEstimate("");
														quickAddTitleRef.current?.blur();
													}
												}}
											/>
											<Input
												value={quickAddEstimate}
												onChange={(e) => setQuickAddEstimate(e.target.value)}
												placeholder="est. d"
												inputMode="decimal"
												className="h-7 w-16 text-xs"
												data-testid="task-list-quick-add-estimate"
												onKeyDown={(e) => {
													if (e.key === "Enter" && e.shiftKey) {
														e.preventDefault();
														submitQuickAdd("milestone");
													} else if (e.key === "Enter") {
														e.preventDefault();
														submitQuickAdd("task");
													}
												}}
											/>
											<Button
												size="sm"
												variant="outline"
												className="h-7 gap-1 text-xs"
												onClick={() => submitQuickAdd("task")}
												disabled={!quickAddTitle.trim()}
												data-testid="task-list-quick-add-task"
											>
												<PlusIcon className="size-3" />
												Task
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="h-7 gap-1 text-xs"
												onClick={() => submitQuickAdd("milestone")}
												disabled={!quickAddTitle.trim()}
												data-testid="task-list-quick-add-milestone"
											>
												<CircleDotIcon className="size-3" />
												Milestone
											</Button>
											<span className="ml-auto text-[10px] text-muted-foreground">
												<kbd className="rounded border bg-background px-1 py-0.5 font-mono">
													n
												</kbd>{" "}
												or{" "}
												<kbd className="rounded border bg-background px-1 py-0.5 font-mono">
													⌘ I
												</kbd>{" "}
												to jump here
											</span>
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	);
}

// Render a single flat task row. Indent is in pixels, applied as a CSS
// custom padding on the first cell so grouped trees can offset descendant
// rows without re-flowing the whole row.
function renderFlatTaskRow({
	row,
	selectedTaskId,
	projectId,
	indent,
}: {
	row: Row<TaskListRow>;
	selectedTaskId: TaskId | null;
	projectId: string;
	indent: number;
}) {
	const r = row.original;
	const isSelected = r.id === selectedTaskId;
	return (
		<TableRow
			key={row.id}
			data-testid={`task-list-row-${r.id}`}
			data-selected={isSelected}
			onClick={() => selectTask(projectId, r.id)}
			className={cn("cursor-pointer", isSelected && "bg-accent/60")}
		>
			{row.getVisibleCells().map((cell, idx) => (
				<TableCell
					key={cell.id}
					className={cell.column.id === "title" ? "font-medium" : undefined}
					style={idx === 0 && indent > 0 ? { paddingLeft: indent } : undefined}
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	);
}

// Recursive group-tree renderer. Emits one full-width header row per group
// (clickable to collapse) and indented task rows beneath it. Collapsed
// groups still show the header but skip the contents.
// Walks a key-group tree and rolls up expected-duration + progress across
// every descendant row. The aggregates are duration-weighted so a small
// completed task can't outshout a big unstarted one — matches how a project
// manager would intuitively summarise a milestone.
//
//   • totalDuration  Σ row.duration (expected PERT duration per row)
//   • doneDuration   Σ row.duration * progressFraction
//   • remaining      total − done
//   • progress       weightedProgress / totalDuration  (null when no work)
//   • ci95           ±1.96σ band around totalDuration, derived from each
//                    row's (pessimistic − optimistic)/6 standard deviation
//                    summed in quadrature (independent-tasks assumption).
//                    null when no task has a usable estimate spread.
function summarizeGroup(group: KeyGroupNode<TaskListRow>): {
	totalCount: number;
	completedCount: number;
	completedPct: number | null;
	totalDuration: number;
	doneDuration: number;
	remainingDuration: number;
	progress: number | null;
	ci95: number | null;
} {
	let totalCount = 0;
	let completedCount = 0;
	let totalDuration = 0;
	let doneDuration = 0;
	let variance = 0;
	let hasSpread = false;
	const walk = (node: KeyGroupNode<TaskListRow>) => {
		for (const row of node.rows) {
			totalCount += 1;
			if (row.taskStatus === "completed") completedCount += 1;
			if (row.duration <= 0) continue;
			const pct =
				row.taskStatus === "completed"
					? 100
					: row.taskStatus === "not_started"
						? 0
						: (row.progress ?? 0);
			totalDuration += row.duration;
			doneDuration += (row.duration * pct) / 100;
			const est = row.estimate;
			if (est) {
				const sigma = (est.pessimistic - est.optimistic) / 6;
				if (sigma > 0) {
					variance += sigma * sigma;
					hasSpread = true;
				}
			}
		}
		for (const child of node.children) walk(child);
	};
	walk(group);
	const completedPct =
		totalCount > 0 ? (completedCount / totalCount) * 100 : null;
	if (totalDuration === 0) {
		return {
			totalCount,
			completedCount,
			completedPct,
			totalDuration: 0,
			doneDuration: 0,
			remainingDuration: 0,
			progress: null,
			ci95: null,
		};
	}
	return {
		totalCount,
		completedCount,
		completedPct,
		totalDuration,
		doneDuration,
		remainingDuration: totalDuration - doneDuration,
		progress: (doneDuration / totalDuration) * 100,
		ci95: hasSpread ? 1.96 * Math.sqrt(variance) : null,
	};
}

function renderGroupedRows({
	tree,
	depth,
	collapsedGroups,
	toggleGroup,
	visibleRowById,
	selectedTaskId,
	projectId,
	columnCount,
}: {
	tree: KeyGroupNode<TaskListRow>[];
	depth: number;
	collapsedGroups: Set<string>;
	toggleGroup: (path: string) => void;
	visibleRowById: Map<TaskId, Row<TaskListRow>>;
	selectedTaskId: TaskId | null;
	projectId: string;
	columnCount: number;
}): React.ReactNode[] {
	const nodes: React.ReactNode[] = [];
	for (const group of tree) {
		const collapsed = collapsedGroups.has(group.path);
		const total = countRowsInGroup(group);
		const summary = summarizeGroup(group);
		const indent = depth * 16;
		nodes.push(
			<TableRow
				key={`group-${group.path || "ungrouped"}`}
				data-testid={`task-list-group-${group.path || "ungrouped"}`}
				className="bg-muted/30 hover:bg-muted/40"
			>
				<TableCell
					colSpan={columnCount}
					className="cursor-pointer select-none"
					style={{ paddingLeft: 12 + indent }}
					onClick={() => toggleGroup(group.path)}
				>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
						{collapsed ? (
							<ChevronRightIcon className="size-3.5 text-muted-foreground" />
						) : (
							<ChevronDownIcon className="size-3.5 text-muted-foreground" />
						)}
						<span className="font-mono text-[11px] text-foreground">
							{group.label}
						</span>
						<span className="text-muted-foreground">·</span>
						<span className="text-muted-foreground">
							{total} task{total === 1 ? "" : "s"}
						</span>
						{summary.totalDuration > 0 && (
							<>
								<span className="text-muted-foreground">·</span>
								<span className="text-muted-foreground">
									<span className="tabular-nums text-foreground">
										{fmt(summary.totalDuration)}d
									</span>
									{summary.ci95 !== null && summary.ci95 >= 0.05 && (
										<>
											{" "}
											<span
												className="text-muted-foreground/70"
												title="95% confidence interval — ±1.96σ from each row's PERT spread, summed in quadrature."
											>
												±{fmt(summary.ci95)}d
											</span>
										</>
									)}{" "}
									est.
								</span>
								<span className="text-muted-foreground">·</span>
								<span className="text-muted-foreground">
									<span className="tabular-nums text-foreground">
										{fmt(summary.doneDuration)}d
									</span>{" "}
									done /{" "}
									<span className="tabular-nums text-foreground">
										{fmt(summary.remainingDuration)}d
									</span>{" "}
									left
								</span>
							</>
						)}
						{summary.progress !== null && (
							<>
								<span className="text-muted-foreground">·</span>
								<span className="text-muted-foreground">
									<span className="tabular-nums text-foreground">
										{Math.round(summary.progress)}%
									</span>{" "}
									done
								</span>
							</>
						)}
						{summary.completedPct !== null && summary.totalCount > 0 && (
							<>
								<span className="text-muted-foreground">·</span>
								<span className="text-muted-foreground">
									<span className="tabular-nums text-foreground">
										{summary.completedCount}/{summary.totalCount}
									</span>{" "}
									(
									<span className="tabular-nums text-foreground">
										{Math.round(summary.completedPct)}%
									</span>
									) completed
								</span>
							</>
						)}
					</div>
				</TableCell>
			</TableRow>,
		);
		if (collapsed) continue;
		for (const row of group.rows) {
			const tableRow = visibleRowById.get(row.id);
			if (!tableRow) continue;
			nodes.push(
				renderFlatTaskRow({
					row: tableRow,
					selectedTaskId,
					projectId,
					indent: 12 + (depth + 1) * 16,
				}),
			);
		}
		if (group.children.length > 0) {
			nodes.push(
				...renderGroupedRows({
					tree: group.children,
					depth: depth + 1,
					collapsedGroups,
					toggleGroup,
					visibleRowById,
					selectedTaskId,
					projectId,
					columnCount,
				}),
			);
		}
	}
	return nodes;
}

function SortIndicator({ sort }: { sort: false | "asc" | "desc" }) {
	if (sort === "asc")
		return <ArrowUpIcon className="size-3 text-muted-foreground" />;
	if (sort === "desc")
		return <ArrowDownIcon className="size-3 text-muted-foreground" />;
	return <ArrowUpDownIcon className="size-3 text-muted-foreground/40" />;
}

// Null values sort to the bottom regardless of direction — keeps cycle-row
// rows from polluting the head of the list.
function nullableNumberSort<T extends { es: number | null }>(
	a: { original: T },
	b: { original: T },
	id: string,
): number {
	const av = (a.original as Record<string, unknown>)[id] as number | null;
	const bv = (b.original as Record<string, unknown>)[id] as number | null;
	if (av === null && bv === null) return 0;
	if (av === null) return 1;
	if (bv === null) return -1;
	return av - bv;
}

function TitleEdit({
	initial,
	onCommit,
	onCancel,
	autoFocus = true,
}: {
	initial: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
	autoFocus?: boolean;
}) {
	const [value, setValue] = useState(initial);
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	return (
		<Input
			ref={ref}
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => onCommit(value.trim())}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onCommit(value.trim());
				} else if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
			onClick={(e) => e.stopPropagation()}
			className="h-7 text-xs"
			data-testid="task-list-title-input"
		/>
	);
}

// Compact key editor — monospace input, same Enter/Escape/blur semantics as
// TitleEdit. Empty value (after trim) clears the field via the parent's
// commit handler.
function KeyEdit({
	initial,
	onCommit,
	onCancel,
	autoFocus = true,
}: {
	initial: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
	autoFocus?: boolean;
}) {
	const [value, setValue] = useState(initial);
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	return (
		<Input
			ref={ref}
			value={value}
			placeholder="ungrouped"
			onChange={(e) => setValue(e.target.value)}
			onBlur={() => onCommit(value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onCommit(value);
				} else if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
			onClick={(e) => e.stopPropagation()}
			className="h-7 font-mono text-xs"
			data-testid="task-list-key-input"
		/>
	);
}

// Three small number inputs in a row for inline editing of the three-point
// estimate. Enter / blur commits all three; Escape cancels. The unit picker
// is kept out of this row — it changes rarely; users hop to the inspector
// for that.
function EstimateEdit({
	initial,
	onCommit,
	onCancel,
	autoFocus = true,
}: {
	initial: Estimate;
	onCommit: (next: Estimate) => void;
	onCancel: () => void;
	autoFocus?: boolean;
}) {
	const [optimistic, setOptimistic] = useState(String(initial.optimistic));
	const [mostLikely, setMostLikely] = useState(String(initial.mostLikely));
	const [pessimistic, setPessimistic] = useState(String(initial.pessimistic));
	// Imperative focus avoids the a11y autoFocus warning; we only fire once
	// on mount, and only when the caller asked for it.
	const firstInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) firstInputRef.current?.focus();
	}, [autoFocus]);

	const commit = () => {
		const parse = (s: string, fallback: number) => {
			const n = Number.parseFloat(s);
			return Number.isFinite(n) && n >= 0 ? n : fallback;
		};
		onCommit({
			optimistic: parse(optimistic, initial.optimistic),
			mostLikely: parse(mostLikely, initial.mostLikely),
			pessimistic: parse(pessimistic, initial.pessimistic),
			unit: initial.unit,
		});
	};

	const inputClass =
		"h-7 w-12 rounded border bg-background px-1 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring";

	return (
		// Form lets Enter submit naturally and avoids the a11y warning about
		// onKeyDown on a static <div>. We still need to swallow the click so
		// it doesn't bubble up and re-select the row.
		<form
			className="flex items-center justify-end gap-1"
			onSubmit={(e) => {
				e.preventDefault();
				commit();
			}}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
		>
			<input
				ref={firstInputRef}
				type="number"
				min={0}
				step="0.5"
				value={optimistic}
				onChange={(e) => setOptimistic(e.target.value)}
				onBlur={commit}
				className={inputClass}
				aria-label="Optimistic estimate"
				data-testid="task-list-estimate-o"
			/>
			<span className="text-muted-foreground">/</span>
			<input
				type="number"
				min={0}
				step="0.5"
				value={mostLikely}
				onChange={(e) => setMostLikely(e.target.value)}
				onBlur={commit}
				className={inputClass}
				aria-label="Most likely estimate"
				data-testid="task-list-estimate-m"
			/>
			<span className="text-muted-foreground">/</span>
			<input
				type="number"
				min={0}
				step="0.5"
				value={pessimistic}
				onChange={(e) => setPessimistic(e.target.value)}
				onBlur={commit}
				className={inputClass}
				aria-label="Pessimistic estimate"
				data-testid="task-list-estimate-p"
			/>
			<span className="ml-0.5 text-[10px] text-muted-foreground">
				{initial.unit[0]}
			</span>
		</form>
	);
}

function EmptyList() {
	return (
		<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
			<div className="max-w-sm space-y-1">
				<p className="font-medium text-foreground">No tasks yet.</p>
				<p>Use the quick-add row below, or the toolbar in the Network view.</p>
			</div>
		</div>
	);
}

function NoMatches({ onClear }: { onClear: () => void }) {
	return (
		<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
			<div className="max-w-sm space-y-2">
				<p className="font-medium text-foreground">No tasks match.</p>
				<Button variant="link" className="h-auto p-0 text-xs" onClick={onClear}>
					Clear filter
				</Button>
			</div>
		</div>
	);
}

function KindIcon({ kind, critical }: { kind: TaskKind; critical: boolean }) {
	if (kind === "container")
		return <FolderIcon className="size-3.5 text-muted-foreground" />;
	if (kind === "milestone")
		return <CircleDotIcon className="size-3.5 text-muted-foreground" />;
	if (critical) return <ZapIcon className="size-3.5 text-destructive" />;
	return <div className="size-2 rounded-full bg-muted-foreground" />;
}

function fmt(n: number): string {
	// Snap floating-point noise (e.g. -1.4e-15) to zero so the table never
	// displays "-0.00" for an effectively-zero slack.
	const snapped = Math.abs(n) < 1e-6 ? 0 : n;
	if (Number.isInteger(snapped)) return snapped.toString();
	return snapped.toFixed(2);
}

function fmtNullable(n: number | null): string {
	if (n === null) return "—";
	return fmt(n);
}

// Reused button for the read-mode of an inline-editable date cell. Keeps the
// disabled / hint / activation-on-double-click handling in one spot.
function DateCellButton({
	value,
	disabled,
	hint,
	onActivate,
}: {
	value: string | undefined;
	disabled: boolean;
	hint?: string;
	onActivate: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onDoubleClick={(ev) => {
				ev.stopPropagation();
				if (!disabled) onActivate();
			}}
			title={hint}
			className="w-full text-left text-xs text-muted-foreground tabular-nums hover:text-foreground disabled:cursor-default"
		>
			{value || "—"}
		</button>
	);
}

// Date input bound to a single yyyy-mm-dd string. Enter / blur commits;
// Escape cancels. Clearing the field commits an empty string so the caller
// can delete the field on the doc.
function DateEdit({
	value,
	autoFocus = true,
	onCommit,
	onCancel,
	"data-testid": testId,
}: {
	value: string | undefined;
	autoFocus?: boolean;
	onCommit: (next: string) => void;
	onCancel: () => void;
	"data-testid"?: string;
}) {
	const [draft, setDraft] = useState(value ?? "");
	const initialRef = useRef(value ?? "");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		setDraft(value ?? "");
		initialRef.current = value ?? "";
	}, [value]);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);
	const commit = useCallback(() => {
		if (draft === initialRef.current) {
			onCancel();
			return;
		}
		onCommit(draft);
	}, [draft, onCommit, onCancel]);
	return (
		<input
			ref={inputRef}
			type="date"
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
				} else if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
			data-testid={testId}
			className="h-7 w-full rounded border bg-background px-1.5 text-xs tabular-nums"
		/>
	);
}

// Small number input + % suffix for inline progress editing. The parent
// commit handler applies the inspector's status / date side-effects so the
// row stays consistent with the percentage (0 → not-started, 100 → completed,
// in-between → in-progress).
function ProgressEdit({
	initial,
	autoFocus = true,
	onCommit,
	onCancel,
}: {
	initial: number;
	autoFocus?: boolean;
	onCommit: (next: number) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(String(initial));
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	const commit = () => {
		const parsed = Number.parseFloat(value);
		onCommit(Number.isFinite(parsed) ? parsed : initial);
	};
	return (
		<form
			className="flex items-center justify-end gap-1"
			onSubmit={(e) => {
				e.preventDefault();
				commit();
			}}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
		>
			<input
				ref={ref}
				type="number"
				min={0}
				max={100}
				step="1"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onBlur={commit}
				className="h-7 w-14 rounded border bg-background px-1.5 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
				aria-label="Progress percentage"
				data-testid="task-list-progress-input"
			/>
			<span className="text-[10px] text-muted-foreground">%</span>
		</form>
	);
}

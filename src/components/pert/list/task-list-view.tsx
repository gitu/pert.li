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
	SettingsIcon,
	ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { computeSchedule, type ScheduleResult } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore, selectTask } from "#/lib/pert/store";
import {
	countRowsInGroup,
	groupTasksByKey,
	type KeyGroupNode,
} from "#/lib/pert/task-key";
import type { Estimate, PertDoc, TaskId, TaskKind } from "#/lib/pert/types";
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

const DEFAULT_VIEW_COLUMN_VISIBILITY: VisibilityState = {
	kind: false,
	duration: false,
	ef: false,
};

// In edit mode the user has explicitly asked to mass-edit; show every
// editable column by default so they can tab through everything.
const DEFAULT_EDIT_COLUMN_VISIBILITY: VisibilityState = {};

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
	// "Edit all" mode flips every editable cell into its input variant at
	// once, so the user can tab through and modify the whole table without
	// double-clicking each cell. Disabled when no changeDoc is available
	// (read-only context like Storybook).
	const [editAll, setEditAll] = useState(false);
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
		],
		[editingId, editingEstimateId, editingKeyId, editAll, changeDoc],
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
						onClick={() => setGrouped((v) => !v)}
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
						onClick={() => setEditAll((v) => !v)}
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
						// Open is controlled by the trigger button below. Ignore
						// onOpenChange's other triggers (selecting an item, outside
						// click, Escape) so the menu only closes on a second click of
						// the Columns button — matches the user's "stay open while I
						// pick what I want" expectation.
						onOpenChange={(open) => {
							if (open) setColumnsOpen(true);
						}}
					>
						<DropdownMenuTrigger asChild>
							<Button
								variant={columnsOpen ? "secondary" : "outline"}
								size="sm"
								className="h-7 gap-1.5 text-xs"
								data-testid="task-list-columns"
								onClick={() => setColumnsOpen((v) => !v)}
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
				{visibleRows.length === 0 ? (
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
							{grouped && groupedTree
								? renderGroupedRows({
										tree: groupedTree,
										depth: 0,
										collapsedGroups,
										toggleGroup,
										visibleRowById,
										selectedTaskId,
										projectId,
										columnCount: visibleColumnCount,
									})
								: visibleRows.map((row) =>
										renderFlatTaskRow({
											row,
											selectedTaskId,
											projectId,
											indent: 0,
										}),
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
					<div className="flex items-center gap-1.5 text-xs">
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
				<p>
					Switch to the Network view and double-click the canvas to add one.
				</p>
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

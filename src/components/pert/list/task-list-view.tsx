import { useStore } from "@tanstack/react-store";
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import {
	ArrowDownIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	CircleDotIcon,
	FolderIcon,
	SettingsIcon,
	ZapIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PresenceBadge } from "#/components/pert/presence/presence-badge";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
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
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
	const [globalFilter, setGlobalFilter] = useState("");
	const [editingId, setEditingId] = useState<TaskId | null>(null);
	// Estimate editing is keyed separately so it can be live alongside (or
	// instead of) title editing on a different row without one cancelling
	// the other on focus changes.
	const [editingEstimateId, setEditingEstimateId] = useState<TaskId | null>(
		null,
	);

	const columns = useMemo<ColumnDef<TaskListRow>[]>(
		() => [
			{
				accessorKey: "title",
				header: "Title",
				size: 320,
				cell: ({ row }) => {
					const r = row.original;
					const editing = editingId === r.id;
					return (
						<div className="flex items-center gap-2">
							<KindIcon kind={r.kind} critical={r.critical} />
							{editing && changeDoc ? (
								<TitleEdit
									initial={r.title}
									onCommit={(value) => {
										changeDoc((d) => {
											const t = d.tasksById[r.id];
											if (t) t.title = value;
										});
										setEditingId(null);
									}}
									onCancel={() => setEditingId(null)}
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
					const editing = editingEstimateId === r.id;
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
								onCommit={(next) => {
									changeDoc((d) => {
										const t = d.tasksById[r.id];
										if (!t) return;
										t.estimate = next;
									});
									setEditingEstimateId(null);
								}}
								onCancel={() => setEditingEstimateId(null)}
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
		[editingId, editingEstimateId, changeDoc],
	);

	const table = useReactTable({
		data: rows,
		columns,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			globalFilter,
		},
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
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
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="h-7 gap-1.5 text-xs"
								data-testid="task-list-columns"
							>
								<SettingsIcon className="size-3.5" />
								Columns
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-40">
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
										className="text-xs capitalize"
									>
										{col.id}
									</DropdownMenuCheckboxItem>
								))}
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
							{visibleRows.map((row) => {
								const r = row.original;
								const isSelected = r.id === selectedTaskId;
								return (
									<TableRow
										key={row.id}
										data-testid={`task-list-row-${row.id}`}
										data-selected={isSelected}
										onClick={() => selectTask(projectId, r.id)}
										className={cn(
											"cursor-pointer",
											isSelected && "bg-accent/60",
										)}
									>
										{row.getVisibleCells().map((cell) => (
											<TableCell
												key={cell.id}
												className={
													cell.column.id === "title" ? "font-medium" : undefined
												}
											>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										))}
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	);
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
}: {
	initial: string;
	onCommit: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<Input
			autoFocus
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

// Three small number inputs in a row for inline editing of the three-point
// estimate. Enter / blur commits all three; Escape cancels. The unit picker
// is kept out of this row — it changes rarely; users hop to the inspector
// for that.
function EstimateEdit({
	initial,
	onCommit,
	onCancel,
}: {
	initial: Estimate;
	onCommit: (next: Estimate) => void;
	onCancel: () => void;
}) {
	const [optimistic, setOptimistic] = useState(String(initial.optimistic));
	const [mostLikely, setMostLikely] = useState(String(initial.mostLikely));
	const [pessimistic, setPessimistic] = useState(String(initial.pessimistic));

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

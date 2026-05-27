import { useStore } from "@tanstack/react-store";
import { LayersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	buildDependencyMatrix,
	type MatrixCell,
	shortDependencyType,
	toggleDependencyMutation,
} from "#/lib/pert/matrix";
import { computeSchedule } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore, selectTask } from "#/lib/pert/store";
import { parseKeySegments } from "#/lib/pert/task-key";
import type { PertDoc, Task } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Dependency matrix: rows are predecessors, columns are successors. Click a
// cell to toggle a finish_to_start dep. Useful when the network view feels
// crowded — visual scan for missing/extra links is straightforward here.

export type MatrixViewProps = {
	projectId: string;
	doc: PertDoc;
};

export function MatrixView({ projectId, doc }: MatrixViewProps) {
	const model = useMemo(() => buildDependencyMatrix(doc), [doc]);
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);
	// Pull the doc mutator from the cross-pane store (lifted by the project
	// route). Stories that mount the matrix directly will get a no-op
	// mutator unless the caller wires one in via a different code path.
	const changeDoc = useStore(projectDocStore, (s) =>
		s.projectId === projectId ? s.changeDoc : null,
	);

	const handleToggle = (cell: MatrixCell) => {
		if (!changeDoc) return;
		const mut = toggleDependencyMutation(cell);
		if (mut) changeDoc(mut);
	};

	const criticalSet = useMemo(() => {
		if (!scheduleResult.ok) return new Set<string>();
		return new Set(scheduleResult.schedule.criticalTaskIds);
	}, [scheduleResult]);

	// Optional grouping: when on, tasks are re-sorted by their dotted key
	// (parseKeySegments → lexicographic) and visual borders mark the
	// boundary between adjacent groups on both axes. Cells stay indexed by
	// task id (via the buildDependencyMatrix lookup) so we can permute the
	// row + column order without re-running the builder.
	const [grouped, setGrouped] = useState(false);
	const taskOrder = useMemo(
		() => orderTasks(model.tasks, grouped),
		[model.tasks, grouped],
	);
	const groupBoundaries = useMemo(() => {
		if (!grouped) return new Set<number>();
		return computeGroupBoundaries(taskOrder);
	}, [grouped, taskOrder]);

	const tasks = taskOrder;
	const cellIndexById = useMemo(() => {
		const m = new Map<string, number>();
		for (let i = 0; i < model.tasks.length; i++) {
			m.set(model.tasks[i].id, i);
		}
		return m;
	}, [model.tasks]);

	if (tasks.length === 0) {
		return (
			<div className="flex h-full flex-col">
				<MatrixHeader
					count={0}
					cycle={!scheduleResult.ok}
					grouped={grouped}
					onToggleGrouped={() => setGrouped((g) => !g)}
				/>
				<div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
					<div className="max-w-sm space-y-1">
						<p className="font-medium text-foreground">No tasks yet.</p>
						<p>Add tasks from the Network view to populate the matrix.</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="flex h-full flex-col overflow-hidden"
			data-testid="matrix-view"
		>
			<MatrixHeader
				count={tasks.length}
				cycle={!scheduleResult.ok}
				grouped={grouped}
				onToggleGrouped={() => setGrouped((g) => !g)}
			/>
			<div className="flex-1 overflow-auto p-4">
				<table className="border-collapse text-xs" data-testid="matrix-table">
					<thead>
						<tr>
							<th className="sticky left-0 top-0 z-20 min-w-[180px] max-w-[220px] border-b border-r bg-card px-2 py-1 text-left font-medium text-muted-foreground">
								predecessor ↓ / successor →
							</th>
							{tasks.map((col, ci) => (
								<th
									key={`col-${col.id}`}
									scope="col"
									className={cn(
										"sticky top-0 h-40 min-w-[28px] max-w-[28px] border-b bg-card p-0 align-bottom",
										col.id === selectedTaskId && "bg-accent/40",
										groupBoundaries.has(ci) &&
											"border-l-2 border-l-foreground/30",
									)}
								>
									{/* Upright column label: `vertical-rl` stacks the text
									    vertically; the extra 180° rotation flips it so it
									    reads bottom-to-top (tilt head left). Keeps the full
									    title visible inside its own column without bleeding
									    into the neighbours. */}
									<button
										type="button"
										onClick={() => selectTask(projectId, col.id)}
										className="flex h-full w-full items-end justify-center overflow-hidden whitespace-nowrap pb-1.5 text-[10px] hover:underline [transform:rotate(180deg)] [writing-mode:vertical-rl]"
										title={col.title || col.id}
									>
										{criticalSet.has(col.id) ? "⚡ " : ""}
										{col.title || col.id}
									</button>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{tasks.map((row, ri) => {
							const sourceRowIdx = cellIndexById.get(row.id);
							if (sourceRowIdx === undefined) return null;
							return (
								<tr
									key={`row-${row.id}`}
									className={cn(row.id === selectedTaskId && "bg-accent/40")}
								>
									<th
										scope="row"
										className={cn(
											"sticky left-0 z-10 max-w-[220px] truncate border-r bg-card px-2 py-1 text-left text-xs font-medium",
											criticalSet.has(row.id) && "text-destructive",
											groupBoundaries.has(ri) &&
												"border-t-2 border-t-foreground/30",
										)}
									>
										<button
											type="button"
											onClick={() => selectTask(projectId, row.id)}
											className="block w-full truncate text-left hover:underline"
											title={row.title || row.id}
											data-testid={`matrix-row-${row.id}`}
										>
											{row.key && (
												<span className="mr-1 font-mono text-[9px] text-muted-foreground">
													{row.key}
												</span>
											)}
											{criticalSet.has(row.id) ? "⚡ " : ""}
											{row.title || row.id}
										</button>
									</th>
									{tasks.map((col, ci) => {
										const sourceColIdx = cellIndexById.get(col.id);
										if (sourceColIdx === undefined) return null;
										const cell = model.cells[sourceRowIdx][sourceColIdx];
										return (
											<MatrixCellButton
												key={`${cell.from}-${cell.to}`}
												cell={cell}
												onToggle={handleToggle}
												readOnly={!changeDoc}
												topBorder={groupBoundaries.has(ri)}
												leftBorder={groupBoundaries.has(ci)}
											/>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// Sort a flat task list by its dotted `key` (e.g. M1.A → ["M1","A"]) so
// adjacent rows share a prefix; tasks without a key go last, alphabetised.
// Returns a new array — never mutates `tasks`.
function orderTasks(tasks: Task[], grouped: boolean): Task[] {
	if (!grouped) return tasks;
	const annotated = tasks.map((t, i) => ({
		t,
		idx: i,
		segs: parseKeySegments(t.key),
	}));
	annotated.sort((a, b) => {
		// Empty keys to the end so the labelled groups read first.
		if (a.segs.length === 0 && b.segs.length > 0) return 1;
		if (b.segs.length === 0 && a.segs.length > 0) return -1;
		for (let i = 0; i < Math.min(a.segs.length, b.segs.length); i++) {
			const cmp = a.segs[i].localeCompare(b.segs[i], undefined, {
				numeric: true,
			});
			if (cmp !== 0) return cmp;
		}
		if (a.segs.length !== b.segs.length) {
			return a.segs.length - b.segs.length;
		}
		return (a.t.title || a.t.id).localeCompare(b.t.title || b.t.id, undefined, {
			numeric: true,
		});
	});
	return annotated.map((a) => a.t);
}

// Indices where the *first segment* of the dotted key changes between
// adjacent tasks. Used to draw a heavier border between groups on the
// matrix axes. The 0th index is never a boundary (no preceding row).
function computeGroupBoundaries(tasks: Task[]): Set<number> {
	const out = new Set<number>();
	for (let i = 1; i < tasks.length; i++) {
		const prev = parseKeySegments(tasks[i - 1].key)[0] ?? "";
		const curr = parseKeySegments(tasks[i].key)[0] ?? "";
		if (prev !== curr) out.add(i);
	}
	return out;
}

function MatrixHeader({
	count,
	cycle,
	grouped,
	onToggleGrouped,
}: {
	count: number;
	cycle: boolean;
	grouped: boolean;
	onToggleGrouped: () => void;
}) {
	return (
		<header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
			<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Matrix · {count}×{count}
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant={grouped ? "default" : "outline"}
					size="sm"
					className="h-7 gap-1.5 text-xs"
					onClick={onToggleGrouped}
					aria-pressed={grouped}
					data-testid="matrix-group"
					title={
						grouped
							? "Stop grouping; restore alphabetical order"
							: "Sort tasks by their dotted key and draw group boundaries"
					}
				>
					<LayersIcon className="size-3.5" />
					{grouped ? "Grouped" : "Group"}
				</Button>
				{cycle ? (
					<span className="text-xs text-destructive">
						Cycle detected — schedule unavailable
					</span>
				) : (
					<span className="text-xs text-muted-foreground">
						Click a cell to toggle a finish→start dependency
					</span>
				)}
			</div>
		</header>
	);
}

function MatrixCellButton({
	cell,
	onToggle,
	readOnly,
	topBorder,
	leftBorder,
}: {
	cell: MatrixCell;
	onToggle: (cell: MatrixCell) => void;
	readOnly: boolean;
	topBorder?: boolean;
	leftBorder?: boolean;
}) {
	const active = cell.dependencyId !== null;
	const label = active
		? shortDependencyType(cell.type ?? "finish_to_start")
		: "";
	return (
		<td
			className={cn(
				"size-9 border border-border/40 p-0 text-center",
				cell.diagonal && "bg-muted/40",
				topBorder && "border-t-2 border-t-foreground/30",
				leftBorder && "border-l-2 border-l-foreground/30",
			)}
		>
			<button
				type="button"
				onClick={() => onToggle(cell)}
				disabled={cell.diagonal || readOnly}
				aria-label={
					cell.diagonal
						? `${cell.from} to itself — blocked`
						: active
							? `Remove dependency from ${cell.from} to ${cell.to}`
							: `Add dependency from ${cell.from} to ${cell.to}`
				}
				data-testid={`matrix-cell-${cell.from}-${cell.to}`}
				data-active={active}
				data-diagonal={cell.diagonal}
				className={cn(
					"flex size-full items-center justify-center text-[10px] font-medium",
					cell.diagonal
						? "cursor-not-allowed text-muted-foreground/40"
						: active
							? "bg-primary/80 text-primary-foreground hover:bg-primary"
							: "hover:bg-accent/50",
					readOnly && !cell.diagonal && "cursor-default opacity-60",
				)}
			>
				{cell.diagonal ? "—" : label}
			</button>
		</td>
	);
}

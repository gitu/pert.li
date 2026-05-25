import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";
import {
	buildDependencyMatrix,
	type MatrixCell,
	shortDependencyType,
	toggleDependencyMutation,
} from "#/lib/pert/matrix";
import { computeSchedule } from "#/lib/pert/schedule";
import { projectDocStore, selectionStore, selectTask } from "#/lib/pert/store";
import type { PertDoc } from "#/lib/pert/types";
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

	const tasks = model.tasks;
	if (tasks.length === 0) {
		return (
			<div className="flex h-full flex-col">
				<MatrixHeader count={0} cycle={!scheduleResult.ok} />
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
			<MatrixHeader count={tasks.length} cycle={!scheduleResult.ok} />
			<div className="flex-1 overflow-auto p-4">
				<table className="border-collapse text-xs" data-testid="matrix-table">
					<thead>
						<tr>
							<th className="sticky left-0 top-0 z-20 min-w-[180px] max-w-[220px] border-b border-r bg-card px-2 py-1 text-left font-medium text-muted-foreground">
								predecessor ↓ / successor →
							</th>
							{tasks.map((col) => (
								<th
									key={`col-${col.id}`}
									scope="col"
									className={cn(
										"sticky top-0 h-24 min-w-[36px] border-b bg-card align-bottom",
										col.id === selectedTaskId && "bg-accent/40",
									)}
								>
									<button
										type="button"
										onClick={() => selectTask(projectId, col.id)}
										className="block h-24 origin-bottom-left -rotate-45 truncate whitespace-nowrap px-1 py-1 text-left text-[10px] hover:underline"
										style={{ width: 110 }}
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
						{tasks.map((row, ri) => (
							<tr
								key={`row-${row.id}`}
								className={cn(row.id === selectedTaskId && "bg-accent/40")}
							>
								<th
									scope="row"
									className={cn(
										"sticky left-0 z-10 max-w-[220px] truncate border-r bg-card px-2 py-1 text-left text-xs font-medium",
										criticalSet.has(row.id) && "text-destructive",
									)}
								>
									<button
										type="button"
										onClick={() => selectTask(projectId, row.id)}
										className="block w-full truncate text-left hover:underline"
										title={row.title || row.id}
										data-testid={`matrix-row-${row.id}`}
									>
										{criticalSet.has(row.id) ? "⚡ " : ""}
										{row.title || row.id}
									</button>
								</th>
								{model.cells[ri].map((cell) => (
									<MatrixCellButton
										key={`${cell.from}-${cell.to}`}
										cell={cell}
										onToggle={handleToggle}
										readOnly={!changeDoc}
									/>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function MatrixHeader({ count, cycle }: { count: number; cycle: boolean }) {
	return (
		<header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
			<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Matrix · {count}×{count}
			</div>
			{cycle ? (
				<span className="text-xs text-destructive">
					Cycle detected — schedule unavailable
				</span>
			) : (
				<span className="text-xs text-muted-foreground">
					Click a cell to toggle a finish→start dependency
				</span>
			)}
		</header>
	);
}

function MatrixCellButton({
	cell,
	onToggle,
	readOnly,
}: {
	cell: MatrixCell;
	onToggle: (cell: MatrixCell) => void;
	readOnly: boolean;
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

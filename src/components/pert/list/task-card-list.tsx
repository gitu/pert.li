import { useStore } from "@tanstack/react-store";
import { CircleDotIcon, ZapIcon } from "lucide-react";
import { useMemo } from "react";
import {
	buildTaskListRows,
	type TaskListRow,
} from "#/components/pert/list/task-list-view";
import { Badge } from "#/components/ui/badge";
import { computeSchedule } from "#/lib/pert/schedule";
import { selectionStore, selectTask } from "#/lib/pert/store";
import type { PertDoc, TaskKind, TaskStatus } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Mobile replacement for the desktop TanStack Table. One card per task,
// stacked vertically with comfortable tap targets. Reuses the same
// `buildTaskListRows` pure-derivation function so the row data here matches
// what the desktop table shows — when this view says ES=3, the table view
// would too.

export type TaskCardListProps = {
	projectId: string;
	doc: PertDoc;
};

export function TaskCardList({ projectId, doc }: TaskCardListProps) {
	const scheduleResult = useMemo(() => computeSchedule(doc), [doc]);
	const rows = useMemo(
		() => buildTaskListRows(doc, scheduleResult),
		[doc, scheduleResult],
	);
	const selectedId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	if (rows.length === 0) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
				No tasks yet. Switch to Network on a wider screen to add some.
			</div>
		);
	}

	return (
		<ul
			data-testid="task-card-list"
			className="flex h-full flex-col gap-2 overflow-y-auto p-3"
		>
			{rows.map((row) => (
				<TaskCard
					key={row.id}
					row={row}
					selected={row.id === selectedId}
					onSelect={() => selectTask(projectId, row.id)}
				/>
			))}
		</ul>
	);
}

function TaskCard({
	row,
	selected,
	onSelect,
}: {
	row: TaskListRow;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				data-testid={`task-card-${row.id}`}
				className={cn(
					"flex w-full flex-col gap-1.5 rounded-md border bg-card p-3 text-left transition-colors",
					selected
						? "border-primary/60 ring-1 ring-primary/40"
						: "border-border active:bg-accent/40",
				)}
			>
				<div className="flex items-start gap-2">
					<KindIcon kind={row.kind} critical={row.critical} />
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
							{row.number || (
								<span className="text-muted-foreground/60">—</span>
							)}
						</div>
						<div className="truncate text-sm font-medium">
							{row.title || "Untitled task"}
						</div>
					</div>
					<StatusBadge status={row.taskStatus} />
				</div>
				<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
					{row.es !== null && row.ef !== null && (
						<span>
							days {row.es} → {row.ef}
						</span>
					)}
					{row.duration > 0 && <span>· {fmtDays(row.duration)}d</span>}
					{row.critical && (
						<Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
							critical
						</Badge>
					)}
				</div>
			</button>
		</li>
	);
}

function KindIcon({ kind, critical }: { kind: TaskKind; critical: boolean }) {
	if (kind === "milestone") {
		return <CircleDotIcon className="size-4 shrink-0 text-muted-foreground" />;
	}
	if (critical) return <ZapIcon className="size-4 shrink-0 text-destructive" />;
	return <CircleDotIcon className="size-4 shrink-0 text-muted-foreground" />;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
	not_started: "todo",
	in_progress: "doing",
	completed: "done",
};

// Integers render bare ("3d"), fractions to one decimal ("1.3d") so PERT
// three-point estimates don't bleed binary noise into the card UI.
function fmtDays(n: number): string {
	if (Number.isInteger(n)) return n.toString();
	return n.toFixed(1);
}

function StatusBadge({ status }: { status: TaskStatus }) {
	if (status === "not_started") return null;
	return (
		<Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
			{STATUS_LABEL[status]}
		</Badge>
	);
}

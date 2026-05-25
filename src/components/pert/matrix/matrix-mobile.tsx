import { useStore } from "@tanstack/react-store";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { selectionStore, selectTask } from "#/lib/pert/store";
import type { Dependency, PertDoc, Task, TaskId } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Mobile replacement for the desktop N×N dependency grid. One expandable
// row per task with predecessor / successor chip groups. The desktop
// matrix scrolls horizontally past the viewport on phones; this collapses
// to the same information in a shape that works at 390px wide.

export type MatrixMobileProps = {
	projectId: string;
	doc: PertDoc;
};

type DepIndex = {
	predecessors: Map<TaskId, TaskId[]>;
	successors: Map<TaskId, TaskId[]>;
};

function indexDeps(doc: PertDoc): DepIndex {
	const predecessors = new Map<TaskId, TaskId[]>();
	const successors = new Map<TaskId, TaskId[]>();
	for (const dep of Object.values(doc.dependenciesById) as Dependency[]) {
		const from = dep.from.taskId;
		const to = dep.to.taskId;
		if (!from || !to) continue;
		pushToMap(predecessors, to, from);
		pushToMap(successors, from, to);
	}
	return { predecessors, successors };
}

function pushToMap(m: Map<TaskId, TaskId[]>, key: TaskId, value: TaskId): void {
	const list = m.get(key);
	if (list) list.push(value);
	else m.set(key, [value]);
}

export function MatrixMobile({ projectId, doc }: MatrixMobileProps) {
	const tasks = useMemo(
		() =>
			(Object.values(doc.tasksById) as Task[])
				.filter((t) => t.kind !== "container")
				.sort((a, b) =>
					(a.title || "").localeCompare(b.title || "", undefined, {
						sensitivity: "base",
					}),
				),
		[doc.tasksById],
	);
	const index = useMemo(() => indexDeps(doc), [doc]);
	const selectedId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);

	if (tasks.length === 0) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
				No tasks to map yet.
			</div>
		);
	}

	return (
		<ul
			data-testid="matrix-mobile"
			className="flex h-full flex-col divide-y overflow-y-auto"
		>
			{tasks.map((task) => (
				<MatrixRow
					key={task.id}
					task={task}
					predecessors={(index.predecessors.get(task.id) ?? [])
						.map((id) => doc.tasksById[id])
						.filter((t): t is Task => Boolean(t))}
					successors={(index.successors.get(task.id) ?? [])
						.map((id) => doc.tasksById[id])
						.filter((t): t is Task => Boolean(t))}
					selected={task.id === selectedId}
					onSelect={(id) => selectTask(projectId, id)}
				/>
			))}
		</ul>
	);
}

function MatrixRow({
	task,
	predecessors,
	successors,
	selected,
	onSelect,
}: {
	task: Task;
	predecessors: Task[];
	successors: Task[];
	selected: boolean;
	onSelect: (id: TaskId) => void;
}) {
	const [open, setOpen] = useState(false);
	const total = predecessors.length + successors.length;
	return (
		<li>
			<button
				type="button"
				onClick={() => {
					onSelect(task.id);
					setOpen((o) => !o);
				}}
				data-testid={`matrix-mobile-row-${task.id}`}
				className={cn(
					"flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm",
					selected ? "bg-primary/10" : "active:bg-accent/40",
				)}
			>
				<ChevronRightIcon
					className={cn(
						"size-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
					)}
				/>
				<div className="min-w-0 flex-1 truncate font-medium">
					{task.title || "Untitled"}
				</div>
				<span className="shrink-0 text-[11px] text-muted-foreground">
					{total === 0 ? "no deps" : `${total} dep${total === 1 ? "" : "s"}`}
				</span>
			</button>
			{open && (
				<div className="space-y-2 px-3 pb-3">
					<DepGroup
						label="Predecessors"
						tasks={predecessors}
						emptyMessage="No tasks depend on this one being done first."
						onSelect={onSelect}
					/>
					<DepGroup
						label="Successors"
						tasks={successors}
						emptyMessage="Nothing waits on this task to finish."
						onSelect={onSelect}
					/>
				</div>
			)}
		</li>
	);
}

function DepGroup({
	label,
	tasks,
	emptyMessage,
	onSelect,
}: {
	label: string;
	tasks: Task[];
	emptyMessage: string;
	onSelect: (id: TaskId) => void;
}) {
	return (
		<div>
			<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			{tasks.length === 0 ? (
				<div className="text-[11px] text-muted-foreground">{emptyMessage}</div>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{tasks.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onSelect(t.id);
							}}
							className="inline-flex items-center rounded-full border bg-card px-2 py-0.5 text-[11px] active:bg-accent/40"
						>
							{t.title || "Untitled"}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

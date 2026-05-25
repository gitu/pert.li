import { CheckIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
	type DocDiff,
	diffPertDoc,
	type TaskChange,
	type TaskFieldChange,
} from "#/lib/pert/diff";
import type { HistoryGroup } from "#/lib/pert/history";
import {
	dropTaskMutation,
	type RestoreableField,
	reAddTaskMutation,
	restoreDependencyMutation,
	restoreTaskFieldMutation,
} from "#/lib/pert/restore";
import type { Estimate, PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

export type DiffPaneProps = {
	snapshot: PertDoc;
	current: PertDoc;
	group: HistoryGroup;
	onRestore: (mutate: (doc: PertDoc) => void) => void;
};

export function DiffPane({
	snapshot,
	current,
	group,
	onRestore,
}: DiffPaneProps) {
	const diff = useMemo(
		() => diffPertDoc(snapshot, current),
		[snapshot, current],
	);
	const isEmpty = diff.tasks.length === 0 && diff.dependencies.length === 0;

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="diff-pane">
			<header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/20 px-3 py-2 text-xs">
				<span className="font-medium">
					Compared with snapshot before commit #{group.firstIndex + 1}
				</span>
				<CountBadges counts={diff.counts} />
			</header>
			<ScrollArea className="flex-1">
				<div className="space-y-4 p-3">
					{isEmpty ? (
						<p className="text-xs text-muted-foreground">
							No structural difference. (Layout-only changes are intentionally
							ignored.)
						</p>
					) : (
						<>
							{diff.tasks.length > 0 && (
								<section>
									<h4 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
										Tasks
									</h4>
									<ul className="space-y-2">
										{diff.tasks.map((t) => (
											<TaskDiffRow
												key={t.id}
												change={t}
												snapshot={snapshot}
												onRestore={onRestore}
											/>
										))}
									</ul>
								</section>
							)}
							{diff.dependencies.length > 0 && (
								<section>
									<h4 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
										Dependencies
									</h4>
									<ul className="space-y-2">
										{diff.dependencies.map((d) => (
											<DependencyDiffRow
												key={d.id}
												change={d}
												snapshot={snapshot}
												onRestore={onRestore}
											/>
										))}
									</ul>
								</section>
							)}
						</>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function CountBadges({ counts }: { counts: DocDiff["counts"] }) {
	const items: Array<{ label: string; value: number; tone: string }> = [
		{
			label: "+",
			value: counts.tasksAdded + counts.depsAdded,
			tone: "text-emerald-600 dark:text-emerald-400",
		},
		{
			label: "~",
			value: counts.tasksChanged + counts.depsChanged,
			tone: "text-amber-600 dark:text-amber-400",
		},
		{
			label: "−",
			value: counts.tasksRemoved + counts.depsRemoved,
			tone: "text-destructive",
		},
	];
	return (
		<div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-wide">
			{items.map((i) => (
				<span key={i.label} className={cn("tabular-nums", i.tone)}>
					{i.label}
					{i.value}
				</span>
			))}
		</div>
	);
}

function TaskDiffRow({
	change,
	snapshot,
	onRestore,
}: {
	change: TaskChange;
	snapshot: PertDoc;
	onRestore: (mutate: (doc: PertDoc) => void) => void;
}) {
	const title = change.after?.title ?? change.before?.title ?? change.id;
	return (
		<li
			className="rounded-md border bg-card/40 p-2"
			data-testid={`diff-task-${change.id}`}
			data-kind={change.kind}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 text-xs">
					<KindIcon kind={change.kind} />
					<span className="font-medium">{title || "Untitled"}</span>
					<span className="text-muted-foreground">· {change.id}</span>
				</div>
				{change.kind === "added" && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() => onRestore(dropTaskMutation(change.id))}
						data-testid={`diff-action-drop-${change.id}`}
					>
						<RotateCcwIcon className="size-3" /> Drop
					</Button>
				)}
				{change.kind === "removed" && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() => {
							const mut = reAddTaskMutation(snapshot, change.id);
							if (mut) onRestore(mut);
						}}
						data-testid={`diff-action-readd-${change.id}`}
					>
						<RotateCcwIcon className="size-3" /> Restore
					</Button>
				)}
			</div>
			{change.kind === "changed" && change.fields.length > 0 && (
				<ul className="mt-1.5 space-y-1.5">
					{change.fields.map((field) => (
						<FieldDiffRow
							key={field.field}
							field={field}
							onRestore={() => {
								const mut = restoreTaskFieldMutation(
									snapshot,
									change.id,
									field.field as RestoreableField,
								);
								if (mut) onRestore(mut);
							}}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FieldDiffRow({
	field,
	onRestore,
}: {
	field: TaskFieldChange;
	onRestore: () => void;
}) {
	return (
		<li
			className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1 text-[11px]"
			data-testid={`diff-field-${field.field}`}
		>
			<span className="mt-0.5 w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
				{field.field}
			</span>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<span className="truncate text-muted-foreground line-through">
					{renderValue(field, "before")}
				</span>
				<span aria-hidden className="text-muted-foreground">
					→
				</span>
				<span className="truncate font-medium">
					{renderValue(field, "after")}
				</span>
			</div>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-6 shrink-0 gap-1 px-2 text-[10px]"
				onClick={onRestore}
				data-testid={`diff-action-restore-${field.field}`}
			>
				<RotateCcwIcon className="size-3" /> Restore
			</Button>
		</li>
	);
}

function renderValue(field: TaskFieldChange, side: "before" | "after"): string {
	const value = field[side];
	if (value === null || value === undefined) return "—";
	if (field.field === "estimate") {
		const e = value as Estimate;
		return `${e.optimistic}/${e.mostLikely}/${e.pessimistic} ${e.unit}`;
	}
	return String(value);
}

function DependencyDiffRow({
	change,
	snapshot,
	onRestore,
}: {
	change: { id: string; kind: "added" | "removed" | "changed" };
	snapshot: PertDoc;
	onRestore: (mutate: (doc: PertDoc) => void) => void;
}) {
	const label = `dep ${change.id}`;
	return (
		<li
			className="flex items-center justify-between gap-2 rounded-md border bg-card/40 px-2 py-1.5 text-xs"
			data-testid={`diff-dep-${change.id}`}
		>
			<div className="flex items-center gap-1.5">
				<KindIcon kind={change.kind} />
				<span className="font-medium">{label}</span>
			</div>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-6 gap-1 px-2 text-[10px]"
				onClick={() => {
					const mut = restoreDependencyMutation(snapshot, change.id);
					if (mut) onRestore(mut);
				}}
				data-testid={`diff-action-restore-dep-${change.id}`}
			>
				<RotateCcwIcon className="size-3" /> Restore
			</Button>
		</li>
	);
}

function KindIcon({ kind }: { kind: "added" | "removed" | "changed" }) {
	if (kind === "added") {
		return (
			<PlusIcon
				className="size-3.5 text-emerald-600 dark:text-emerald-400"
				aria-label="added"
			/>
		);
	}
	if (kind === "removed") {
		return (
			<MinusIcon className="size-3.5 text-destructive" aria-label="removed" />
		);
	}
	return (
		<CheckIcon
			className="size-3.5 text-amber-600 dark:text-amber-400"
			aria-label="changed"
		/>
	);
}

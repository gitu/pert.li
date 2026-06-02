import { CheckIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
	type DependencyChange,
	type DependencyFieldChange,
	type DocDiff,
	diffPertDoc,
	type TaskChange,
	type TaskFieldChange,
} from "#/lib/pert/diff";
import type { Estimate, PertDoc } from "#/lib/pert/types";
import { cn } from "#/lib/utils";

// Presentational diff: renders the structural delta between two PertDocs
// (added/removed/changed tasks + deps), with an optional per-row action.
//
// Used by:
//  - history-drawer: snapshot vs current, row action = restore from snapshot
//  - history-drawer (two-snapshot mode): A vs B, no action (view-only)
//  - AI proposals: current vs proposed, row action = apply field from proposal
//
// The action surface is intentionally generic: callers pass an `actionMode`
// that controls the button label, and an `onRowAction` callback that gets
// the row context (kind + ids) so the caller can decide what "apply" means.

export type DiffRowKind =
	| { type: "task-field"; taskId: string; field: TaskFieldChange["field"] }
	| { type: "task-added"; taskId: string }
	| { type: "task-removed"; taskId: string }
	| { type: "dependency"; depId: string };

export type DiffActionMode = "restore" | "apply" | "view";

export type DiffBodyProps = {
	before: PertDoc;
	after: PertDoc;
	actionMode: DiffActionMode;
	onRowAction?: (row: DiffRowKind) => void;
	emptyMessage?: string;
};

export function DiffBody({
	before,
	after,
	actionMode,
	onRowAction,
	emptyMessage,
}: DiffBodyProps) {
	const diff = useMemo(() => diffPertDoc(before, after), [before, after]);
	const isEmpty = diff.tasks.length === 0 && diff.dependencies.length === 0;

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="diff-body">
			<ScrollArea className="flex-1">
				<div className="space-y-4 p-3">
					{isEmpty ? (
						<p className="text-xs text-muted-foreground">
							{emptyMessage ??
								"No structural difference. (Layout-only changes are intentionally ignored.)"}
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
												actionMode={actionMode}
												onRowAction={onRowAction}
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
												actionMode={actionMode}
												onRowAction={onRowAction}
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

export function DiffCountBadges({ counts }: { counts: DocDiff["counts"] }) {
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

function actionLabel(mode: DiffActionMode): string {
	if (mode === "restore") return "Restore";
	return "Apply";
}

function TaskDiffRow({
	change,
	actionMode,
	onRowAction,
}: {
	change: TaskChange;
	actionMode: DiffActionMode;
	onRowAction?: (row: DiffRowKind) => void;
}) {
	const title = change.after?.title ?? change.before?.title ?? change.id;
	const showAction = actionMode !== "view" && onRowAction;
	const label = actionLabel(actionMode);
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
				{showAction && change.kind === "added" && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() =>
							onRowAction?.({ type: "task-added", taskId: change.id })
						}
						data-testid={`diff-action-task-added-${change.id}`}
					>
						<RotateCcwIcon className="size-3" />{" "}
						{actionMode === "restore" ? "Drop" : label}
					</Button>
				)}
				{showAction && change.kind === "removed" && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() =>
							onRowAction?.({ type: "task-removed", taskId: change.id })
						}
						data-testid={`diff-action-task-removed-${change.id}`}
					>
						<RotateCcwIcon className="size-3" />{" "}
						{actionMode === "restore" ? "Restore" : label}
					</Button>
				)}
			</div>
			{change.kind === "changed" && change.fields.length > 0 && (
				<ul className="mt-1.5 space-y-1.5">
					{change.fields.map((field) => (
						<FieldDiffRow
							key={field.field}
							field={field}
							actionMode={actionMode}
							onAction={
								showAction
									? () =>
											onRowAction?.({
												type: "task-field",
												taskId: change.id,
												field: field.field,
											})
									: undefined
							}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FieldDiffRow({
	field,
	actionMode,
	onAction,
}: {
	field: TaskFieldChange;
	actionMode: DiffActionMode;
	onAction?: () => void;
}) {
	const isTextBlockField = field.field === "notes";
	return (
		<li
			className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1 text-[11px]"
			data-testid={`diff-field-${field.field}`}
		>
			<span className="mt-0.5 w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
				{field.field}
			</span>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<span
					className={cn(
						isTextBlockField
							? "break-words whitespace-pre-wrap text-muted-foreground line-through"
							: "truncate text-muted-foreground line-through",
					)}
				>
					{renderValue(field, "before")}
				</span>
				<span aria-hidden className="text-muted-foreground">
					→
				</span>
				<span
					className={cn(
						isTextBlockField
							? "break-words whitespace-pre-wrap font-medium"
							: "truncate font-medium",
					)}
				>
					{renderValue(field, "after")}
				</span>
			</div>
			{onAction && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-6 shrink-0 gap-1 px-2 text-[10px]"
					onClick={onAction}
					data-testid={`diff-action-field-${field.field}`}
				>
					<RotateCcwIcon className="size-3" /> {actionLabel(actionMode)}
				</Button>
			)}
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
	actionMode,
	onRowAction,
}: {
	change: DependencyChange;
	actionMode: DiffActionMode;
	onRowAction?: (row: DiffRowKind) => void;
}) {
	const label = `dep ${change.id}`;
	const showAction = actionMode !== "view" && onRowAction;
	return (
		<li
			className="rounded-md border bg-card/40 p-2"
			data-testid={`diff-dep-${change.id}`}
			data-kind={change.kind}
		>
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex items-center gap-1.5">
					<KindIcon kind={change.kind} />
					<span className="font-medium">{label}</span>
				</div>
				{showAction && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-[10px]"
						onClick={() =>
							onRowAction?.({ type: "dependency", depId: change.id })
						}
						data-testid={`diff-action-dep-${change.id}`}
					>
						<RotateCcwIcon className="size-3" /> {actionLabel(actionMode)}
					</Button>
				)}
			</div>
			{change.kind === "changed" && change.fields.length > 0 && (
				<ul className="mt-1.5 space-y-1.5">
					{change.fields.map((field) => (
						<DependencyFieldRow key={field.field} field={field} />
					))}
				</ul>
			)}
		</li>
	);
}

function DependencyFieldRow({ field }: { field: DependencyFieldChange }) {
	return (
		<li
			className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1 text-[11px]"
			data-testid={`diff-dep-field-${field.field}`}
		>
			<span className="mt-0.5 w-20 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
				{field.field}
			</span>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<span className="truncate text-muted-foreground line-through">
					{renderDepValue(field, "before")}
				</span>
				<span aria-hidden className="text-muted-foreground">
					→
				</span>
				<span className="truncate font-medium">
					{renderDepValue(field, "after")}
				</span>
			</div>
		</li>
	);
}

function renderDepValue(
	field: DependencyFieldChange,
	side: "before" | "after",
): string {
	const value = field[side];
	if (value === null || value === undefined) return "—";
	return String(value);
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

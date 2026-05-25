import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	averageEstimatesMutation,
	resolveTaskFieldMutation,
	type TaskConflicts,
	type TaskFieldConflict,
} from "#/lib/pert/conflicts";
import type { Estimate, PertDoc, TaskId } from "#/lib/pert/types";

// Inline-banner + popover for surfaced concurrent-write conflicts on a
// task's fields. Each branch the user picks becomes a *new* change against
// current heads — so other peers see the resolution as a normal edit, and
// CRDT semantics stay clean.

export type ConflictPillProps = {
	conflicts: TaskConflicts;
	taskId: TaskId;
	onResolve: (mutate: (doc: PertDoc) => void) => void;
};

export function ConflictPill({
	conflicts,
	taskId,
	onResolve,
}: ConflictPillProps) {
	if (conflicts.fields.length === 0) return null;
	return (
		<div
			data-testid="conflict-pill"
			className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
		>
			<div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-200">
				<AlertTriangleIcon className="size-3.5" />
				<span>
					Concurrent writes on {conflicts.fields.length}{" "}
					{conflicts.fields.length === 1 ? "field" : "fields"}
				</span>
			</div>
			<ul className="space-y-1.5">
				{conflicts.fields.map((field) => (
					<li key={field.field}>
						<FieldResolver
							field={field}
							onPick={(value) =>
								onResolve(resolveTaskFieldMutation(taskId, field.field, value))
							}
							onAverage={
								field.field === "estimate"
									? () => {
											const mut = averageEstimatesMutation(
												taskId,
												field.values.map((v) => v.value),
											);
											if (mut) onResolve(mut);
										}
									: undefined
							}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

function FieldResolver({
	field,
	onPick,
	onAverage,
}: {
	field: TaskFieldConflict;
	onPick: (value: TaskFieldConflict["values"][number]["value"]) => void;
	onAverage?: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex items-center justify-between gap-2 rounded bg-card/60 px-2 py-1">
			<span className="font-medium tabular-nums text-[10px] uppercase tracking-wide text-muted-foreground">
				{field.field}
			</span>
			<div className="flex items-center gap-1">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="h-6 px-2 text-[10px]"
							data-testid={`conflict-resolve-${field.field}`}
						>
							Resolve ({field.values.length})
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-72 space-y-1.5 p-2 text-xs">
						{field.values.map((v) => (
							<button
								key={v.opId}
								type="button"
								onClick={() => {
									onPick(v.value);
									setOpen(false);
								}}
								data-testid={`conflict-pick-${field.field}-${v.opId}`}
								className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-accent"
							>
								<span className="truncate">
									{renderConflictValue(field.field, v.value)}
								</span>
								<CheckIcon className="size-3 opacity-0 group-hover:opacity-100" />
							</button>
						))}
						{onAverage && (
							<>
								<div className="my-1 h-px bg-border" />
								<button
									type="button"
									onClick={() => {
										onAverage();
										setOpen(false);
									}}
									data-testid="conflict-average-estimate"
									className="w-full rounded px-2 py-1 text-left hover:bg-accent"
								>
									Average all branches
								</button>
							</>
						)}
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}

function renderConflictValue(
	field: TaskFieldConflict["field"],
	value: unknown,
): string {
	if (value === null || value === undefined) return "— (cleared)";
	if (field === "estimate") {
		const e = value as Estimate;
		return `${e.optimistic}/${e.mostLikely}/${e.pessimistic} ${e.unit}`;
	}
	return String(value);
}

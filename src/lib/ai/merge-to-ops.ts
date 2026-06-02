import type { MergeChange, MergeSide } from "#/lib/pert/merge";
import type { Dependency, Task } from "#/lib/pert/types";
import type { EditOp } from "./operations";

// Translates the user's per-row resolutions in the merge drawer into a flat
// list of EditOps that, applied to the live main doc, land the merge. Reuses
// the AI write path (apply-operations.ts → tool-mutators.ts) so the merge
// flow and the AI proposal flow share guarantees — no second writer.
//
// Conflict rows where the user picks "main" (or "skip") produce no ops at
// all: the branch's edit is dropped on the floor. Picking "branch" applies
// the branch's value via the appropriate set_* / remove_* / add_* op.

export type ResolvedMergeChange = MergeChange & {
	// User's pick for this row. Defaults to the row's suggestedSide and is
	// reset on every "computeMerge" call (which the UI re-runs whenever the
	// underlying docs change).
	resolution: MergeSide;
};

export function mergeSelectionToOps(
	selection: ResolvedMergeChange[],
): EditOp[] {
	const ops: EditOp[] = [];
	for (const row of selection) {
		if (row.resolution !== "branch") continue;
		appendOpsForRow(row, ops);
	}
	return ops;
}

function appendOpsForRow(row: ResolvedMergeChange, out: EditOp[]): void {
	if (row.kind === "entity") {
		if (row.classification === "clean-add-from-branch" && row.branchEntity) {
			pushAddOps(row.entity, row.branchEntity, out);
			return;
		}
		if (row.classification === "clean-remove-from-branch") {
			pushRemoveOp(row.entity, row.id, out);
			return;
		}
		if (row.classification === "conflict-modified-vs-removed") {
			// Branch modified, main removed it: re-add with the branch's full
			// shape so the branch's edits stick.
			if (row.branchEntity) pushAddOps(row.entity, row.branchEntity, out);
			return;
		}
		if (row.classification === "conflict-removed-vs-modified") {
			// Branch removed, main modified: deletion wins → remove the entity
			// (the user explicitly picked the branch side).
			pushRemoveOp(row.entity, row.id, out);
			return;
		}
		return;
	}

	// Field row: emit one op per (entity, field, value).
	if (row.entity === "task") {
		const op = taskFieldOp(row.id, row.field, row.branch);
		if (op) out.push(op);
		return;
	}
	const op = dependencyFieldOp(row.id, row.field, row.branch);
	if (op) out.push(op);
}

function pushRemoveOp(
	entity: MergeChange["entity"],
	id: string,
	out: EditOp[],
): void {
	if (entity === "task") {
		out.push({ op: "remove_task", taskId: id });
	} else {
		out.push({ op: "remove_dependency", dependencyId: id });
	}
}

function pushAddOps(
	entity: MergeChange["entity"],
	branchEntity: Task | Dependency,
	out: EditOp[],
): void {
	if (entity === "task") {
		const t = branchEntity as Task;
		out.push({
			op: "add_task",
			id: t.id,
			title: t.title,
			kind: t.kind,
			parentId: t.parentId ?? null,
			estimate: t.estimate,
		});
		// Backfill anything add_task doesn't natively accept.
		if (t.key !== undefined) {
			out.push({ op: "set_key", taskId: t.id, key: t.key ?? null });
		}
		if (t.notes !== undefined) {
			out.push({ op: "set_notes", taskId: t.id, notes: t.notes ?? null });
		}
		if (t.status !== undefined) {
			out.push({ op: "set_status", taskId: t.id, status: t.status });
		}
		if (t.progress !== undefined) {
			out.push({ op: "set_progress", taskId: t.id, progress: t.progress });
		}
		if (t.actualStart !== undefined || t.actualFinish !== undefined) {
			out.push({
				op: "set_actual_dates",
				taskId: t.id,
				actualStart: t.actualStart ?? null,
				actualFinish: t.actualFinish ?? null,
			});
		}
		return;
	}
	const d = branchEntity as Dependency;
	const fromTaskId = d.from.taskId;
	const toTaskId = d.to.taskId;
	if (!fromTaskId || !toTaskId) {
		// Dependency wasn't anchored to two tasks; the add op requires both.
		// Skip silently — the merge UI shouldn't have surfaced this row, but if
		// the doc evolves we want to fail closed rather than corrupt the dep.
		return;
	}
	out.push({
		op: "add_dependency",
		id: d.id,
		fromTaskId,
		toTaskId,
		type: d.type,
	});
	if (d.lagDays !== undefined) {
		out.push({
			op: "set_dependency",
			dependencyId: d.id,
			lagDays: d.lagDays,
		});
	}
	if (d.from.interfaceId) {
		out.push({
			op: "pin_dependency",
			dependencyId: d.id,
			side: "from",
			interfaceId: d.from.interfaceId,
		});
	}
	if (d.to.interfaceId) {
		out.push({
			op: "pin_dependency",
			dependencyId: d.id,
			side: "to",
			interfaceId: d.to.interfaceId,
		});
	}
}

function taskFieldOp(
	taskId: string,
	field: string,
	value: unknown,
): EditOp | null {
	switch (field) {
		case "title":
			return { op: "set_title", taskId, title: value as string };
		case "kind":
			return { op: "set_kind", taskId, kind: value as Task["kind"] };
		case "parentId":
			return { op: "move_task", taskId, parentId: (value as string) ?? null };
		case "key":
			return { op: "set_key", taskId, key: (value as string) ?? null };
		case "notes":
			return { op: "set_notes", taskId, notes: (value as string) ?? null };
		case "estimate": {
			const e = value as Task["estimate"] | undefined;
			if (!e) return null; // No op exists to clear an estimate today.
			return {
				op: "set_estimate",
				taskId,
				optimistic: e.optimistic,
				mostLikely: e.mostLikely,
				pessimistic: e.pessimistic,
				unit: e.unit,
			};
		}
		case "status":
			return value
				? { op: "set_status", taskId, status: value as Task["status"] & string }
				: null;
		case "progress":
			return value === null
				? null
				: { op: "set_progress", taskId, progress: value as number };
		case "actualStart":
			return {
				op: "set_actual_dates",
				taskId,
				actualStart: (value as string) ?? null,
			};
		case "actualFinish":
			return {
				op: "set_actual_dates",
				taskId,
				actualFinish: (value as string) ?? null,
			};
		default:
			return null;
	}
}

function dependencyFieldOp(
	dependencyId: string,
	field: string,
	value: unknown,
): EditOp | null {
	switch (field) {
		case "type":
			return {
				op: "set_dependency",
				dependencyId,
				type: value as Dependency["type"],
			};
		case "lagDays":
			return {
				op: "set_dependency",
				dependencyId,
				lagDays: value as number,
			};
		case "fromInterfaceId":
			return {
				op: "pin_dependency",
				dependencyId,
				side: "from",
				interfaceId: (value as string) ?? null,
			};
		case "toInterfaceId":
			return {
				op: "pin_dependency",
				dependencyId,
				side: "to",
				interfaceId: (value as string) ?? null,
			};
		// fromTaskId / toTaskId have no direct mutator — the user would have to
		// recreate the dependency. We surface that as no-op here; the merge UI
		// shows a warning and points the user at remove + add.
		default:
			return null;
	}
}

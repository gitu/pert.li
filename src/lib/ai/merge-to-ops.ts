import type { MergeChange, MergeSide } from "#/lib/pert/merge";
import type { Dependency, PertDoc, Task } from "#/lib/pert/types";
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

// Filters a merge op batch against the doc it will be applied to, dropping ops
// that a dropped task makes redundant or impossible. Without this, dropping a
// task on one side produces ops that fail harmlessly at apply time — but the
// merge drawer's all-or-nothing dry-run treats any failure as fatal and aborts
// the whole merge. Two failure shapes show up:
//
//   * remove_task cascades (removeTaskMutation deletes every dep touching the
//     task), so a sibling remove_dependency for that same dep then reports
//     "dependency not found".
//   * a clean-add-from-branch dependency whose endpoint task no longer exists
//     on the target reports "task not found". Its follow-up set_dependency op
//     (emitted when the branch dep carried lagDays) then reports "dependency
//     not found".
//
// We simulate task/dep existence as the batch runs — mirroring
// applyOperations + removeTaskMutation's cascade — and drop the ops that would
// reference something gone. applyOperations and the AI proposal path keep their
// strict semantics; only the merge path is sanitised. Returns the appliable
// ops plus the ops that were dropped (for logging / counts).
export function planMergeOps(
	ops: EditOp[],
	target: PertDoc,
): { ops: EditOp[]; dropped: EditOp[] } {
	const tasks = new Set(Object.keys(target.tasksById));
	// Track dep endpoints so we can replay removeTaskMutation's cascade: when a
	// task is removed, every dep touching it disappears with it.
	const depEndpoints = new Map<string, { from?: string; to?: string }>();
	for (const [id, dep] of Object.entries(target.dependenciesById)) {
		depEndpoints.set(id, { from: dep.from.taskId, to: dep.to.taskId });
	}
	const deps = new Set(depEndpoints.keys());

	const kept: EditOp[] = [];
	const dropped: EditOp[] = [];
	for (const op of ops) {
		switch (op.op) {
			case "add_task": {
				if (op.id) tasks.add(op.id);
				kept.push(op);
				break;
			}
			case "remove_task": {
				if (!tasks.has(op.taskId)) {
					dropped.push(op); // Already gone — nothing to remove.
					break;
				}
				tasks.delete(op.taskId);
				// Cascade: drop every dep touching this task from the live set so a
				// later remove_dependency for it is recognised as redundant.
				for (const [depId, ep] of depEndpoints) {
					if (ep.from === op.taskId || ep.to === op.taskId) {
						deps.delete(depId);
					}
				}
				kept.push(op);
				break;
			}
			case "add_dependency": {
				if (!tasks.has(op.fromTaskId) || !tasks.has(op.toTaskId)) {
					dropped.push(op); // Endpoint was dropped — the dep can't exist.
					break;
				}
				if (op.id) {
					deps.add(op.id);
					depEndpoints.set(op.id, {
						from: op.fromTaskId,
						to: op.toTaskId,
					});
				}
				kept.push(op);
				break;
			}
			case "remove_dependency": {
				if (!deps.has(op.dependencyId)) {
					dropped.push(op); // Cascaded away or already absent.
					break;
				}
				deps.delete(op.dependencyId);
				kept.push(op);
				break;
			}
			case "set_dependency": {
				// Follow-up to an add_dependency. If the dep never made it into
				// the live set (its add was dropped, or it was cascaded away),
				// drop it too — otherwise it'd fail "dependency not found".
				if (!deps.has(op.dependencyId)) {
					dropped.push(op);
					break;
				}
				kept.push(op);
				break;
			}
			default:
				// set_* (task), move_task_to_group, group ops, etc. In a merge
				// these always target an entity that exists or is added in-batch,
				// so they pass through untouched.
				kept.push(op);
		}
	}
	return { ops: kept, dropped };
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
			groupId: t.groupId ?? null,
			estimate: t.estimate,
		});
		// Backfill anything add_task doesn't natively accept.
		if (t.numberOverride !== undefined) {
			out.push({
				op: "set_task_number",
				taskId: t.id,
				number: t.numberOverride ?? null,
			});
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
		case "groupId":
			return {
				op: "move_task_to_group",
				taskId,
				groupId: (value as string) ?? null,
			};
		case "numberOverride":
			return {
				op: "set_task_number",
				taskId,
				number: (value as string) ?? null,
			};
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
		// fromTaskId / toTaskId have no direct mutator — the user would have to
		// recreate the dependency. We surface that as no-op here; the merge UI
		// shows a warning and points the user at remove + add.
		default:
			return null;
	}
}

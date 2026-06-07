import { newGroupId } from "#/lib/pert/group-mutations";
import type { PertDoc } from "#/lib/pert/types";
import { type EditOp, editOpSchema } from "./operations";
import {
	addDependencyMutation,
	addTaskMutation,
	assignTaskToGroupMutation,
	createGroupMutation,
	deleteGroupMutation,
	newId,
	removeDependencyMutation,
	removeTaskMutation,
	renameGroupMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setGroupParentMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
	setTaskNumberMutation,
	setTitleMutation,
} from "./tool-mutators";

// Result of running each op. Errors are accumulated rather than thrown so a
// proposal that fails halfway through doesn't leave the proposed doc in a
// half-applied state — the caller decides whether to surface the errors and
// throw out the proposal, or apply the partial.
export type OpResult =
	| { op: EditOp["op"]; index: number; ok: true; id?: string }
	| { op: EditOp["op"]; index: number; ok: false; error: string };

export function applyOperations(doc: PertDoc, ops: EditOp[]): OpResult[] {
	// Pre-scan 1: client-provided ids that collide with entities already in
	// the doc get remapped to fresh ids — and every reference in the batch
	// follows the remap. The model's "phase_1" means *its* phase_1; without
	// the remap, applying two independently-staged proposals that both say
	// `add_task id=phase_1` silently overwrites the first one's task.
	const remap = new Map<string, string>();
	for (const op of ops) {
		// The propose_changes client path is unvalidated, so a batch entry may be
		// null, a primitive, or missing its `op` discriminator. Every raw `op.op`
		// read in this function (the pre-scans, remapOp, and the post-batch
		// normalisation) would throw on such an entry BEFORE runOpSafe's per-op
		// guard runs, aborting the whole batch. Skip non-object entries here and
		// let them fall through to runOpSafe, which records them as failed rows.
		if (op == null || typeof op !== "object") continue;
		if (op.op === "add_task" && op.id && doc.tasksById[op.id]) {
			remap.set(op.id, newId("task"));
		} else if (
			op.op === "add_dependency" &&
			op.id &&
			doc.dependenciesById[op.id]
		) {
			remap.set(op.id, newId("dep"));
		} else if (op.op === "create_group" && op.id && doc.groupsById[op.id]) {
			remap.set(op.id, newGroupId());
		}
	}
	const remapped = remap.size > 0 ? ops.map((op) => remapOp(op, remap)) : ops;

	// Pre-scan 2: group ids this batch will create. add_task / move_task_to_group
	// ops may forward-reference them as groupId (a group's tasks are often
	// emitted before, or after, the create_group op).
	const pendingGroupIds = new Set<string>();
	for (const op of remapped) {
		if (op == null || typeof op !== "object") continue;
		if (op.op === "create_group" && op.id) pendingGroupIds.add(op.id);
	}

	const results: OpResult[] = [];
	for (let i = 0; i < remapped.length; i++) {
		results.push(runOpSafe(doc, remapped[i], i, pendingGroupIds));
	}

	// Post-batch normalisation: a task that forward-referenced a group whose
	// create_group op ultimately failed would carry a dangling groupId. The
	// renderers treat that as ungrouped already, but clear it so the doc stays
	// clean. We key off the RESULTS (every successful add_task reports its id,
	// whether explicit or generated) so default-id tasks are covered too.
	for (let i = 0; i < remapped.length; i++) {
		const op = remapped[i];
		if (op == null || typeof op !== "object" || op.op !== "add_task") continue;
		const r = results[i];
		if (!r.ok || !r.id) continue;
		const task = doc.tasksById[r.id];
		if (!task) continue;
		const gid = task.groupId ?? null;
		if (gid && !doc.groupsById[gid]) {
			// Ungroup it — and drop the now-meaningless ordering, matching
			// assignTaskToGroupMutation's ungroup behaviour.
			task.groupId = null;
			delete task.order;
		}
	}

	return results;
}

// Rewrites every entity-id reference in an op through the collision remap.
// Only ids present in the map change; references to pre-existing doc entities
// pass through untouched.
function remapOp(op: EditOp, remap: Map<string, string>): EditOp {
	// Malformed entries (non-object, or an unknown `op` discriminator) pass
	// through untouched so runOpSafe can report them — never throw here.
	if (op == null || typeof op !== "object") return op;
	const id = (v: string): string => remap.get(v) ?? v;
	const idOrNull = (v: string | null | undefined) =>
		v == null ? v : (remap.get(v) ?? v);
	switch (op.op) {
		case "add_task":
			return {
				...op,
				id: op.id ? id(op.id) : op.id,
				groupId: idOrNull(op.groupId),
			};
		case "remove_task":
		case "set_title":
		case "set_kind":
		case "set_task_number":
		case "set_notes":
		case "set_estimate":
		case "set_status":
		case "set_progress":
		case "set_actual_dates":
			return { ...op, taskId: id(op.taskId) };
		case "move_task_to_group":
			return {
				...op,
				taskId: id(op.taskId),
				groupId: op.groupId === null ? null : id(op.groupId),
			};
		case "add_dependency":
			return {
				...op,
				id: op.id ? id(op.id) : op.id,
				fromTaskId: id(op.fromTaskId),
				toTaskId: id(op.toTaskId),
			};
		case "remove_dependency":
		case "set_dependency":
			return { ...op, dependencyId: id(op.dependencyId) };
		case "create_group":
			return {
				...op,
				id: op.id ? id(op.id) : op.id,
				parentGroupId: idOrNull(op.parentGroupId),
			};
		case "rename_group":
		case "delete_group":
			return { ...op, groupId: id(op.groupId) };
		case "set_group_parent":
			return {
				...op,
				groupId: id(op.groupId),
				parentGroupId: op.parentGroupId === null ? null : id(op.parentGroupId),
			};
		default:
			// Object with an unrecognised `op` — leave it for runOpSafe to reject.
			return op;
	}
}

// Validates one op against editOpSchema, then runs it with a try/catch around
// the mutator. Two failure modes are contained here so a single bad op never
// aborts the whole batch (honoring the file-header contract):
//   1. Schema-invalid ops (the client tool boundary doesn't validate input, so
//      the model's raw JSON arrives unchecked). An op missing a required field
//      — e.g. add_task without a title — would otherwise reach the mutator and
//      assign an `undefined` property, which is legal on the plain-JS staging
//      clone but throws Automerge's "Cannot assign undefined value" RangeError
//      on the live change proxy (the work-plan auto-apply crash).
//   2. Any unexpected throw from the mutator itself.
function runOpSafe(
	doc: PertDoc,
	op: EditOp,
	index: number,
	pendingGroupIds: ReadonlySet<string>,
): OpResult {
	// op may be null/primitive (unvalidated client input) — read the
	// discriminator defensively so this label line never throws.
	const opName =
		(op != null && typeof op === "object"
			? (op as { op?: EditOp["op"] }).op
			: undefined) ?? ("unknown" as EditOp["op"]);
	const parsed = editOpSchema.safeParse(op);
	if (!parsed.success) {
		const reason = parsed.error.issues
			.map((iss) => {
				const path = iss.path.join(".");
				return path ? `${path}: ${iss.message}` : iss.message;
			})
			.join("; ");
		return {
			op: opName,
			index,
			ok: false,
			error: `invalid operation: ${reason}`,
		};
	}
	try {
		return runOp(doc, parsed.data, index, pendingGroupIds);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : `non-Error thrown: ${String(err)}`;
		return { op: opName, index, ok: false, error: message };
	}
}

function runOp(
	doc: PertDoc,
	op: EditOp,
	index: number,
	pendingGroupIds: ReadonlySet<string>,
): OpResult {
	switch (op.op) {
		case "add_task": {
			const r = addTaskMutation(
				doc,
				{
					title: op.title,
					kind: op.kind,
					groupId: op.groupId,
					estimate: op.estimate,
				},
				op.id,
				{ pendingGroupIds },
			);
			if ("id" in r) return { op: op.op, index, ok: true, id: r.id };
			return { op: op.op, index, ok: false, error: r.error };
		}
		case "remove_task": {
			const r = removeTaskMutation(doc, { taskId: op.taskId });
			return toResult(op.op, index, r);
		}
		case "set_title": {
			const r = setTitleMutation(doc, { taskId: op.taskId, title: op.title });
			return toResult(op.op, index, r);
		}
		case "set_kind": {
			const r = setKindMutation(doc, { taskId: op.taskId, kind: op.kind });
			return toResult(op.op, index, r);
		}
		case "set_task_number": {
			const r = setTaskNumberMutation(doc, {
				taskId: op.taskId,
				number: op.number,
			});
			return toResult(op.op, index, r);
		}
		case "set_notes": {
			const r = setNotesMutation(doc, { taskId: op.taskId, notes: op.notes });
			return toResult(op.op, index, r);
		}
		case "set_estimate": {
			const r = setEstimateMutation(doc, {
				taskId: op.taskId,
				optimistic: op.optimistic,
				mostLikely: op.mostLikely,
				pessimistic: op.pessimistic,
				unit: op.unit,
			});
			return toResult(op.op, index, r);
		}
		case "set_status": {
			const r = setStatusMutation(doc, {
				taskId: op.taskId,
				status: op.status,
			});
			return toResult(op.op, index, r);
		}
		case "set_progress": {
			const r = setProgressMutation(doc, {
				taskId: op.taskId,
				progress: op.progress,
			});
			return toResult(op.op, index, r);
		}
		case "set_actual_dates": {
			const r = setActualDatesMutation(doc, {
				taskId: op.taskId,
				actualStart: op.actualStart,
				actualFinish: op.actualFinish,
			});
			return toResult(op.op, index, r);
		}
		case "move_task_to_group": {
			const r = assignTaskToGroupMutation(doc, {
				taskId: op.taskId,
				groupId: op.groupId,
			});
			return toResult(op.op, index, r);
		}
		case "add_dependency": {
			const r = addDependencyMutation(
				doc,
				{
					fromTaskId: op.fromTaskId,
					toTaskId: op.toTaskId,
					type: op.type,
				},
				op.id,
			);
			if ("id" in r) return { op: op.op, index, ok: true, id: r.id };
			return { op: op.op, index, ok: false, error: r.error };
		}
		case "remove_dependency": {
			const r = removeDependencyMutation(doc, {
				dependencyId: op.dependencyId,
			});
			return toResult(op.op, index, r);
		}
		case "set_dependency": {
			const r = setDependencyMutation(doc, {
				dependencyId: op.dependencyId,
				type: op.type,
				lagDays: op.lagDays,
			});
			return toResult(op.op, index, r);
		}
		case "create_group": {
			const r = createGroupMutation(doc, {
				id: op.id,
				name: op.name,
				parentGroupId: op.parentGroupId,
			});
			if (r.ok) return { op: op.op, index, ok: true, id: r.id };
			return { op: op.op, index, ok: false, error: r.error };
		}
		case "rename_group": {
			const r = renameGroupMutation(doc, {
				groupId: op.groupId,
				name: op.name,
			});
			return toResult(op.op, index, r);
		}
		case "set_group_parent": {
			const r = setGroupParentMutation(doc, {
				groupId: op.groupId,
				parentGroupId: op.parentGroupId,
			});
			return toResult(op.op, index, r);
		}
		case "delete_group": {
			const r = deleteGroupMutation(doc, { groupId: op.groupId });
			return toResult(op.op, index, r);
		}
	}
}

function toResult(
	op: EditOp["op"],
	index: number,
	r: { ok: true } | { ok: false; error: string },
): OpResult {
	if (r.ok) return { op, index, ok: true };
	return { op, index, ok: false, error: r.error };
}

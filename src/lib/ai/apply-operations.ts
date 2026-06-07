import type { PertDoc } from "#/lib/pert/types";
import { type EditOp, editOpSchema } from "./operations";
import {
	addDependencyMutation,
	addInterfaceMutation,
	addTaskMutation,
	moveTaskMutation,
	newId,
	pinDependencyMutation,
	removeDependencyMutation,
	removeInterfaceMutation,
	removeTaskMutation,
	setActualDatesMutation,
	setDependencyMutation,
	setEstimateMutation,
	setInterfaceMutation,
	setKeyMutation,
	setKindMutation,
	setNotesMutation,
	setProgressMutation,
	setStatusMutation,
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
		}
	}
	const remapped = remap.size > 0 ? ops.map((op) => remapOp(op, remap)) : ops;

	// Pre-scan 2: container ids this batch will add. add_task ops may
	// forward-reference them as parentId (children are often emitted before
	// their parent container).
	const pendingContainerIds = new Set<string>();
	for (const op of remapped) {
		if (op == null || typeof op !== "object") continue;
		if (op.op === "add_task" && op.id && (op.kind ?? "task") === "container") {
			pendingContainerIds.add(op.id);
		}
	}

	const results: OpResult[] = [];
	for (let i = 0; i < remapped.length; i++) {
		results.push(runOpSafe(doc, remapped[i], i, pendingContainerIds));
	}

	// Post-batch normalisation: a task whose parent op failed (or whose
	// forward references form a cycle) would be invisible on the nested
	// canvas. Re-root it instead so the user still sees what was added.
	const addedTaskIds: string[] = [];
	for (let i = 0; i < remapped.length; i++) {
		const op = remapped[i];
		const r = results[i];
		if (op == null || typeof op !== "object") continue;
		if (op.op === "add_task" && r.ok && r.id) addedTaskIds.push(r.id);
	}
	for (const id of addedTaskIds) {
		const task = doc.tasksById[id];
		if (!task) continue;
		if (hasBrokenParentChain(doc, id)) task.parentId = null;
	}

	return results;
}

// Walks parentId up from `id`; broken = a missing ancestor, a cycle, or an
// ancestor that isn't a container (possible when a later op in the same batch
// demotes a parent via set_kind — only containers may have children).
function hasBrokenParentChain(doc: PertDoc, id: string): boolean {
	const seen = new Set<string>([id]);
	let cursor = doc.tasksById[id]?.parentId ?? null;
	while (cursor) {
		if (seen.has(cursor)) return true;
		const parent = doc.tasksById[cursor];
		if (!parent) return true;
		if (parent.kind !== "container") return true;
		seen.add(cursor);
		cursor = parent.parentId ?? null;
	}
	return false;
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
				parentId: idOrNull(op.parentId),
			};
		case "remove_task":
		case "set_title":
		case "set_kind":
		case "set_key":
		case "set_notes":
		case "set_estimate":
		case "set_status":
		case "set_progress":
		case "set_actual_dates":
			return { ...op, taskId: id(op.taskId) };
		case "move_task":
			return {
				...op,
				taskId: id(op.taskId),
				parentId: op.parentId === null ? null : id(op.parentId),
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
		case "pin_dependency":
			return { ...op, dependencyId: id(op.dependencyId) };
		case "add_interface":
			return {
				...op,
				containerId: id(op.containerId),
				taskRef: idOrNull(op.taskRef),
			};
		case "remove_interface":
			return { ...op, containerId: id(op.containerId) };
		case "set_interface":
			return {
				...op,
				containerId: id(op.containerId),
				taskRef: idOrNull(op.taskRef),
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
	pendingContainerIds: ReadonlySet<string>,
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
		return runOp(doc, parsed.data, index, pendingContainerIds);
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
	pendingContainerIds: ReadonlySet<string>,
): OpResult {
	switch (op.op) {
		case "add_task": {
			const r = addTaskMutation(
				doc,
				{
					title: op.title,
					kind: op.kind,
					parentId: op.parentId,
					estimate: op.estimate,
				},
				op.id,
				{ pendingContainerIds },
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
		case "set_key": {
			const r = setKeyMutation(doc, { taskId: op.taskId, key: op.key });
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
		case "move_task": {
			const r = moveTaskMutation(doc, {
				taskId: op.taskId,
				parentId: op.parentId,
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
		case "pin_dependency": {
			const r = pinDependencyMutation(doc, {
				dependencyId: op.dependencyId,
				side: op.side,
				interfaceId: op.interfaceId,
			});
			return toResult(op.op, index, r);
		}
		case "add_interface": {
			const r = addInterfaceMutation(
				doc,
				{
					containerId: op.containerId,
					kind: op.kind,
					label: op.label,
					taskRef: op.taskRef,
				},
				op.id,
			);
			if ("id" in r) return { op: op.op, index, ok: true, id: r.id };
			return { op: op.op, index, ok: false, error: r.error };
		}
		case "remove_interface": {
			const r = removeInterfaceMutation(doc, {
				containerId: op.containerId,
				interfaceId: op.interfaceId,
			});
			return toResult(op.op, index, r);
		}
		case "set_interface": {
			const r = setInterfaceMutation(doc, {
				containerId: op.containerId,
				interfaceId: op.interfaceId,
				label: op.label,
				taskRef: op.taskRef,
			});
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

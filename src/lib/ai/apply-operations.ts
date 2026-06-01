import type { PertDoc } from "#/lib/pert/types";
import type { EditOp } from "./operations";
import {
	addDependencyMutation,
	addInterfaceMutation,
	addTaskMutation,
	moveTaskMutation,
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
	const results: OpResult[] = [];
	for (let i = 0; i < ops.length; i++) {
		results.push(runOp(doc, ops[i], i));
	}
	return results;
}

function runOp(doc: PertDoc, op: EditOp, index: number): OpResult {
	switch (op.op) {
		case "add_task": {
			const { id } = addTaskMutation(
				doc,
				{
					title: op.title,
					kind: op.kind,
					parentId: op.parentId,
					estimate: op.estimate,
				},
				op.id,
			);
			return { op: op.op, index, ok: true, id };
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

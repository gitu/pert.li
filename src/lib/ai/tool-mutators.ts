import { todayIsoDate } from "#/lib/pert/calendar";
import { canReparent } from "#/lib/pert/reparent";
import type {
	Dependency,
	DependencyType,
	Estimate,
	EstimateUnit,
	PertDoc,
	Task,
	TaskId,
	TaskKind,
	TaskStatus,
} from "#/lib/pert/types";

// Pure mutators for the chat-tool implementations. Each one takes a draft
// `PertDoc` (the parameter passed by Automerge `change()`) plus typed args,
// applies the edit in place, and returns a small JSON-friendly result.
//
// Keeping these separate from the tool definitions means we can unit-test
// them on a synthetic doc without spinning up Automerge or React, and the
// client glue stays a one-liner.

export function newId(prefix: string): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return `${prefix}_${s}`;
}

export type AddTaskArgs = {
	title: string;
	kind?: TaskKind;
	parentId?: TaskId | null;
	estimate?: Estimate;
};

export function addTaskMutation(
	d: PertDoc,
	args: AddTaskArgs,
	id: TaskId = newId("task"),
): { id: TaskId } {
	const kind: TaskKind = args.kind ?? "task";
	const base: Task = {
		id,
		kind,
		title: args.title,
		parentId: args.parentId ?? null,
	};
	if (kind === "task") {
		base.estimate = args.estimate ?? {
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		};
	} else if (args.estimate) {
		base.estimate = args.estimate;
	}
	d.tasksById[id] = base;
	return { id };
}

export type SetEstimateArgs = {
	taskId: TaskId;
	optimistic: number;
	mostLikely: number;
	pessimistic: number;
	unit?: EstimateUnit;
};

export function setEstimateMutation(
	d: PertDoc,
	args: SetEstimateArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.optimistic > args.mostLikely)
		return { ok: false, error: "optimistic must be <= mostLikely" };
	if (args.mostLikely > args.pessimistic)
		return { ok: false, error: "mostLikely must be <= pessimistic" };
	task.estimate = {
		optimistic: args.optimistic,
		mostLikely: args.mostLikely,
		pessimistic: args.pessimistic,
		unit: args.unit ?? task.estimate?.unit ?? "day",
	};
	return { ok: true };
}

export type SetTitleArgs = { taskId: TaskId; title: string };

export function setTitleMutation(
	d: PertDoc,
	args: SetTitleArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	task.title = args.title;
	return { ok: true };
}

export type AddDependencyArgs = {
	fromTaskId: TaskId;
	toTaskId: TaskId;
	type?: DependencyType;
};

export function addDependencyMutation(
	d: PertDoc,
	args: AddDependencyArgs,
	id = newId("dep"),
): { id: string } | { ok: false; error: string } {
	if (!d.tasksById[args.fromTaskId])
		return { ok: false, error: `task ${args.fromTaskId} not found` };
	if (!d.tasksById[args.toTaskId])
		return { ok: false, error: `task ${args.toTaskId} not found` };
	if (args.fromTaskId === args.toTaskId)
		return { ok: false, error: "self-dependency is not allowed" };
	for (const dep of Object.values(d.dependenciesById)) {
		if (
			dep.from.taskId === args.fromTaskId &&
			dep.to.taskId === args.toTaskId
		) {
			return { id: dep.id };
		}
	}
	const dep: Dependency = {
		id,
		from: { taskId: args.fromTaskId, port: "finish" },
		to: { taskId: args.toTaskId, port: "start" },
		type: args.type ?? "finish_to_start",
	};
	d.dependenciesById[id] = dep;
	return { id };
}

export type RemoveDependencyArgs = { dependencyId: string };

export function removeDependencyMutation(
	d: PertDoc,
	args: RemoveDependencyArgs,
): { ok: true } | { ok: false; error: string } {
	if (!d.dependenciesById[args.dependencyId])
		return { ok: false, error: `dependency ${args.dependencyId} not found` };
	delete d.dependenciesById[args.dependencyId];
	return { ok: true };
}

export type RemoveTaskArgs = { taskId: TaskId };

export function removeTaskMutation(
	d: PertDoc,
	args: RemoveTaskArgs,
): { ok: true } | { ok: false; error: string } {
	if (!d.tasksById[args.taskId])
		return { ok: false, error: `task ${args.taskId} not found` };
	delete d.tasksById[args.taskId];
	for (const [depId, dep] of Object.entries(d.dependenciesById)) {
		if (dep.from.taskId === args.taskId || dep.to.taskId === args.taskId) {
			delete d.dependenciesById[depId];
		}
	}
	for (const t of Object.values(d.tasksById)) {
		if (t.parentId === args.taskId) t.parentId = null;
	}
	return { ok: true };
}

// ── Editable-field mutators ────────────────────────────────────────────────
//
// Each one mirrors the corresponding inspector control so the model can drive
// the same behaviours a human user would (including side-effects like
// auto-stamping started/finished dates when status flips).

export type SetKindArgs = { taskId: TaskId; kind: TaskKind };

export function setKindMutation(
	d: PertDoc,
	args: SetKindArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	task.kind = args.kind;
	if (args.kind === "milestone") delete task.estimate;
	if (args.kind === "task" && !task.estimate) {
		task.estimate = {
			optimistic: 1,
			mostLikely: 2,
			pessimistic: 4,
			unit: "day",
		};
	}
	return { ok: true };
}

export type SetKeyArgs = { taskId: TaskId; key: string | null };

export function setKeyMutation(
	d: PertDoc,
	args: SetKeyArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const trimmed = args.key?.trim() ?? "";
	if (trimmed.length === 0) delete task.key;
	else task.key = trimmed;
	return { ok: true };
}

export type SetNotesArgs = { taskId: TaskId; notes: string | null };

export function setNotesMutation(
	d: PertDoc,
	args: SetNotesArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.notes === null || args.notes === "") delete task.notes;
	else task.notes = args.notes;
	return { ok: true };
}

export type MoveTaskArgs = { taskId: TaskId; parentId: TaskId | null };

export function moveTaskMutation(
	d: PertDoc,
	args: MoveTaskArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const current = task.parentId ?? null;
	if (current === args.parentId) return { ok: true };
	if (args.parentId !== null) {
		const target = d.tasksById[args.parentId];
		if (!target)
			return { ok: false, error: `container ${args.parentId} not found` };
		if (target.kind !== "container")
			return {
				ok: false,
				error: `task ${args.parentId} is not a container`,
			};
		if (!canReparent(d, args.taskId, args.parentId))
			return {
				ok: false,
				error: "move would create a cycle in the hierarchy",
			};
	}
	task.parentId = args.parentId;
	return { ok: true };
}

export type SetStatusArgs = { taskId: TaskId; status: TaskStatus };

// Mirrors the inspector's setStatus behaviour: when the user marks something
// in_progress or completed, the started / finished dates are stamped and
// progress snaps to 0 / 100 so the engine has consistent values.
export function setStatusMutation(
	d: PertDoc,
	args: SetStatusArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const today = todayIsoDate();
	task.status = args.status;
	if (args.status === "not_started") {
		delete task.progress;
		delete task.actualStart;
		delete task.actualFinish;
	} else if (args.status === "in_progress") {
		if (typeof task.progress !== "number") task.progress = 0;
		if (!task.actualStart) task.actualStart = today;
		delete task.actualFinish;
	} else if (args.status === "completed") {
		task.progress = 100;
		if (!task.actualStart) task.actualStart = today;
		task.actualFinish = today;
	}
	return { ok: true };
}

export type SetProgressArgs = { taskId: TaskId; progress: number };

export function setProgressMutation(
	d: PertDoc,
	args: SetProgressArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	const today = todayIsoDate();
	const clamped = Math.max(0, Math.min(100, Math.round(args.progress)));
	task.progress = clamped;
	if (task.status !== "in_progress" && task.status !== "completed") {
		task.status = "in_progress";
		if (!task.actualStart) task.actualStart = today;
	}
	if (clamped >= 100) {
		task.status = "completed";
		task.actualFinish = today;
	} else if (task.status === "completed") {
		task.status = "in_progress";
		delete task.actualFinish;
	}
	return { ok: true };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SetActualDatesArgs = {
	taskId: TaskId;
	actualStart?: string | null;
	actualFinish?: string | null;
};

export function setActualDatesMutation(
	d: PertDoc,
	args: SetActualDatesArgs,
): { ok: true } | { ok: false; error: string } {
	const task = d.tasksById[args.taskId];
	if (!task) return { ok: false, error: `task ${args.taskId} not found` };
	if (args.actualStart !== undefined) {
		if (args.actualStart === null || args.actualStart === "") {
			delete task.actualStart;
		} else if (!ISO_DATE.test(args.actualStart)) {
			return {
				ok: false,
				error: "actualStart must be ISO yyyy-mm-dd",
			};
		} else {
			task.actualStart = args.actualStart;
		}
	}
	if (args.actualFinish !== undefined) {
		if (args.actualFinish === null || args.actualFinish === "") {
			delete task.actualFinish;
		} else if (!ISO_DATE.test(args.actualFinish)) {
			return {
				ok: false,
				error: "actualFinish must be ISO yyyy-mm-dd",
			};
		} else {
			task.actualFinish = args.actualFinish;
		}
	}
	return { ok: true };
}

export type SetDependencyArgs = {
	dependencyId: string;
	type?: DependencyType;
	lagDays?: number | null;
};

export function setDependencyMutation(
	d: PertDoc,
	args: SetDependencyArgs,
): { ok: true } | { ok: false; error: string } {
	const dep = d.dependenciesById[args.dependencyId];
	if (!dep)
		return { ok: false, error: `dependency ${args.dependencyId} not found` };
	if (args.type !== undefined) dep.type = args.type;
	if (args.lagDays !== undefined) {
		if (args.lagDays === null) delete dep.lagDays;
		else dep.lagDays = args.lagDays;
	}
	return { ok: true };
}

// Read-only summary used by the model to inspect the current graph.
// Strips Automerge proxy magic and large fields (positions, metadata) the
// model never needs to plan.
export type ProjectSummary = {
	title: string;
	tasks: Array<{
		id: TaskId;
		title: string;
		kind: TaskKind;
		parentId: TaskId | null;
		key?: string;
		estimate?: Estimate;
		status?: TaskStatus;
		progress?: number;
		notes?: string;
		actualStart?: string;
		actualFinish?: string;
	}>;
	dependencies: Array<{
		id: string;
		fromTaskId: TaskId | null;
		toTaskId: TaskId | null;
		type: DependencyType;
		lagDays?: number;
	}>;
};

export function summarizeProject(doc: PertDoc): ProjectSummary {
	return {
		title: doc.title,
		tasks: Object.values(doc.tasksById).map((t) => ({
			id: t.id,
			title: t.title,
			kind: t.kind,
			parentId: t.parentId,
			key: t.key,
			estimate: t.estimate
				? {
						optimistic: t.estimate.optimistic,
						mostLikely: t.estimate.mostLikely,
						pessimistic: t.estimate.pessimistic,
						unit: t.estimate.unit,
					}
				: undefined,
			status: t.status,
			progress: t.progress,
			notes: t.notes,
			actualStart: t.actualStart,
			actualFinish: t.actualFinish,
		})),
		dependencies: Object.values(doc.dependenciesById).map((d) => ({
			id: d.id,
			fromTaskId: d.from.taskId ?? null,
			toTaskId: d.to.taskId ?? null,
			type: d.type,
			lagDays: d.lagDays,
		})),
	};
}
